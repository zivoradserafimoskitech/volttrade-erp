#!/usr/bin/env python3
"""
VoltTrade one-time historical price backfill (ENTSO-E transparency platform).

Downloads day-ahead prices (documentType A44) for HU (HUPX, 15y), RS
(SEEPEX, 8y) and MK (MEMO, 2y) and upserts them into the Supabase table
`market_price_history` so the ML models get real training data.

Also supports zonal Actual Total Load backfill (`--document A65`,
`--load-zones MK,HU,RS`): same endpoint with documentType=A65, Points carry
`<quantity>` (unit MAW = MW) instead of `<price.amount>`, curveType is
usually A01 (sequential — NO gap-fill, unlike A03). Rows land in
`load_history` (or `load_<zone>.csv` in CSV mode). The A44 price behavior
(default) is unchanged.

Runs with `python3 backfill_history.py` — stdlib + `requests` only.

Storage:
  * If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set: PostgREST upsert
    (Prefer: resolution=merge-duplicates), batches of 500. Conflict target
    (organization_id, timestamp, zone, product) for prices (A44) and
    (organization_id, timestamp, zone) for load (A65).
  * Otherwise: per-zone CSVs in --csv-dir (default ./backfill_out):
    prices_<zone>.csv (A44) or load_<zone>.csv (A65).

Resume: per zone, continue from the hour after the newest stored row
(Supabase max(timestamp) for zone+product, or the CSV's last row).
`--start` disables resume for all zones.

IMPORTANT API notes (verified against web-api.tp.entsoe.eu):
  * You MUST send `Accept: application/xml`; without it the server returns
    an HTML SPA page (HTTP 200 or 503 with an HTML body).
  * The platform intermittently returns HTTP 503 (maintenance); the script
    retries with exponential backoff and continues with other zones.
"""

import argparse
import csv
import logging
import os
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

API_URL = "https://web-api.tp.entsoe.eu/api"

# Zone code -> (bidding zone EIC, default lookback in years)
ZONES = {
    "HU": ("10YHU-MAVIR----U", 15),  # HUPX
    "RS": ("10YCS-SERBIATSOV", 8),   # SEEPEX / Serbia
    "MK": ("10YMK-MEPSO----8", 2),   # MEMO / Macedonia
}

# A65 Actual Total Load zones -> (control area EIC, default lookback years)
LOAD_ZONES = {
    "MK": ("10YMK-MEPSO----8", 4),   # MEPSO control area
    "HU": ("10YHU-MAVIR----U", 10),  # MAVIR control area
    "RS": ("10YCS-SERBIATSOV", 8),   # EMS / Serbia control area
}

PRODUCT = "day_ahead"
SOURCE = "entsoe"
TABLE = "market_price_history"
CONFLICT_TARGET = "organization_id,timestamp,zone,product"
LOAD_TABLE = "load_history"
LOAD_CONFLICT_TARGET = "organization_id,timestamp,zone"
UPSERT_BATCH = 500

BACKOFF_START_S = 5.0
BACKOFF_CAP_S = 300.0

log = logging.getLogger("backfill")


# ---------------------------------------------------------------------------
# A44 Publication_MarketDocument parsing
# (mirrors supabase/functions/sync-entsoe-prices/index.ts::parsePrices)
# ---------------------------------------------------------------------------

def _parse_dt(text):
    """Parse ENTSO-E timestamps like '2026-08-31T22:00Z' or with offset."""
    text = text.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _local_name(tag):
    """Strip any XML namespace from an element tag."""
    return tag.rsplit("}", 1)[-1]


def _parse_document(xml_text, value_tag):
    """
    Shared parser for Publication_MarketDocument-style payloads into
    hourly rows. `value_tag` is the per-Point value element
    ("price.amount" for A44, "quantity" for A65).

    Returns [(hour_start_utc_datetime, value), ...] sorted by time.
    """
    root = ET.fromstring(xml_text)
    buckets = {}  # hour datetime -> [sum, count]

    for ts in root.iter():
        if _local_name(ts.tag) != "TimeSeries":
            continue
        curve_type = None
        for ch in ts:
            if _local_name(ch.tag) == "curveType":
                curve_type = (ch.text or "").strip()

        for el in ts.iter():
            if _local_name(el.tag) != "Period":
                continue
            start = end = None
            resolution = "PT60M"
            points = []  # (position, value)
            for ch in el.iter():
                name = _local_name(ch.tag)
                if name == "timeInterval":
                    for g in ch:
                        gname = _local_name(g.tag)
                        if gname == "start":
                            start = _parse_dt(g.text)
                        elif gname == "end":
                            end = _parse_dt(g.text)
                elif name == "resolution":
                    resolution = (ch.text or "").strip()
                elif name == "Point":
                    pos = value = None
                    for g in ch:
                        gname = _local_name(g.tag)
                        if gname == "position":
                            pos = int(g.text.strip())
                        elif gname == value_tag:
                            value = float(g.text.strip())
                    if pos is not None and value is not None:
                        points.append((pos, value))

            if start is None or not points:
                continue

            if "15" in resolution:
                step_min = 15
            elif "30" in resolution:
                step_min = 30
            else:
                step_min = 60

            max_pos = (round((end - start).total_seconds() / (step_min * 60))
                       if end is not None else 0)

            points.sort()
            last = max_pos if max_pos > 0 else points[-1][0]

            for i, (pos, value) in enumerate(points):
                # A03 gap fill: a missing position means the previous value
                # stays valid until the next stated position. A65 load is
                # usually A01 (sequential) — no gap fill, each Point covers
                # exactly its own position.
                if curve_type == "A03":
                    nxt = points[i + 1][0] if i + 1 < len(points) else last + 1
                else:
                    nxt = pos + 1
                for p in range(pos, nxt):
                    t = start + timedelta(minutes=(p - 1) * step_min)
                    hour = t.replace(minute=0, second=0, microsecond=0)
                    b = buckets.setdefault(hour, [0.0, 0])
                    b[0] += value
                    b[1] += 1

    rows = []
    for hour in sorted(buckets):
        s, n = buckets[hour]
        rows.append((hour, round(s / n, 2)))
    return rows


def parse_a44(xml_text):
    """
    Parse an A44 Publication_MarketDocument into hourly rows.

    Handles resolutions PT60M/PT30M/PT15M and curveType A03 (a missing
    position means the previous price stays valid until the next stated
    position). Sub-hourly points are averaged into hourly UTC delivery
    slots. Negative prices are kept.

    Returns [(hour_start_utc_datetime, price_eur_mwh), ...] sorted by time.
    """
    return _parse_document(xml_text, "price.amount")


def parse_a65(xml_text):
    """
    Parse an A65 (Actual Total Load) Publication_MarketDocument into
    hourly rows. Points carry `<quantity>` (unit MAW = MW). curveType is
    usually A01 (sequential): a missing position stays MISSING — no
    gap-fill, unlike A03 prices.

    Returns [(hour_start_utc_datetime, load_mw), ...] sorted by time.
    """
    return _parse_document(xml_text, "quantity")


# ---------------------------------------------------------------------------
# ENTSO-E HTTP client with retry / backoff
# ---------------------------------------------------------------------------

class EntsoeError(Exception):
    """Fatal for the current zone (after retries are exhausted)."""


def _looks_like_html(body):
    head = body.lstrip()[:200].lower()
    return head.startswith("<!doctype") or head.startswith("<html")


def _format_period(dt):
    """yyyyMMddHHmm in UTC."""
    return dt.strftime("%Y%m%d%H%M")


def fetch_month(token, eic, start, end, retries, session=None,
                document_type="A44"):
    """
    Fetch one chunk [start, end) of A44 (prices) or A65 (load) data,
    retrying on HTTP != 200, non-XML (HTML SPA) bodies and XML parse
    failures with exponential backoff (5s -> cap 5 min).
    Raises EntsoeError after `retries` attempts.
    """
    http = session or requests
    parser = parse_a65 if document_type == "A65" else parse_a44
    params = {
        "securityToken": token,
        "documentType": document_type,
        "in_Domain": eic,
        "out_Domain": eic,
        "periodStart": _format_period(start),
        "periodEnd": _format_period(end),
    }
    delay = BACKOFF_START_S
    last_err = "unknown error"
    for attempt in range(1, retries + 1):
        try:
            resp = http.get(
                API_URL, params=params,
                headers={"Accept": "application/xml"},  # REQUIRED: otherwise HTML SPA
                timeout=60,
            )
            body = resp.text
            if resp.status_code != 200:
                last_err = f"HTTP {resp.status_code}: {body[:200]!r}"
            elif _looks_like_html(body):
                # API answered with its SPA page instead of XML (happens
                # without Accept header or during outages with HTTP 200).
                last_err = "non-XML (HTML) response body"
            else:
                try:
                    return parser(body)
                except ET.ParseError as exc:
                    last_err = f"XML parse failure: {exc}"
        except requests.RequestException as exc:
            last_err = f"request error: {exc}"
        if attempt < retries:
            log.warning("  chunk %s..%s attempt %d/%d failed (%s); retry in %.0fs",
                        _format_period(start), _format_period(end),
                        attempt, retries, last_err, delay)
            time.sleep(delay)
            delay = min(delay * 2, BACKOFF_CAP_S)
    raise EntsoeError(f"giving up after {retries} attempts; last error: {last_err}")


def month_chunks(start, end):
    """Yield (chunk_start, chunk_end) covering [start, end) in <=31-day slices."""
    cur = start
    while cur < end:
        nxt = cur + timedelta(days=31)
        if nxt > end:
            nxt = end
        yield cur, nxt
        cur = nxt


# ---------------------------------------------------------------------------
# Storage: Supabase PostgREST upsert, or CSV fallback
# ---------------------------------------------------------------------------

class SupabaseSink:
    """PostgREST upsert sink. `document` selects the target table/shape:
    "A44" -> market_price_history (prices), "A65" -> load_history (load)."""

    def __init__(self, url, key, org_id, document="A44"):
        self.document = document
        self.table = LOAD_TABLE if document == "A65" else TABLE
        self.base = url.rstrip("/") + "/rest/v1/" + self.table
        self.headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
        self.org_id = org_id

    def max_timestamp(self, zone):
        """Newest stored timestamp for this org+zone(+product), or None."""
        params = {
            "select": "timestamp",
            "organization_id": "eq." + self.org_id,
            "zone": "eq." + zone,
            "order": "timestamp.desc",
            "limit": "1",
        }
        if self.document != "A65":
            params["product"] = "eq." + PRODUCT
        resp = requests.get(self.base, headers=self.headers, params=params, timeout=30)
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return None
        return _parse_dt(rows[0]["timestamp"])

    def _row(self, zone, hour, value):
        row = {
            "organization_id": self.org_id,
            "timestamp": hour.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            "zone": zone,
            "source": SOURCE,
        }
        if self.document == "A65":
            row["load_mw"] = value
        else:
            row["product"] = PRODUCT
            row["price_eur_mwh"] = value
        return row

    def upsert(self, zone, rows):
        """rows: [(hour datetime, value)] -> count upserted."""
        sent = 0
        for i in range(0, len(rows), UPSERT_BATCH):
            batch = rows[i:i + UPSERT_BATCH]
            payload = [self._row(zone, hour, value) for hour, value in batch]
            resp = requests.post(self.base, headers=self.headers,
                                 json=payload, timeout=60)
            if resp.status_code >= 300:
                raise EntsoeError(
                    f"Supabase upsert failed HTTP {resp.status_code}: {resp.text[:300]}")
            sent += len(batch)
        return sent


class CsvSink:
    """CSV fallback sink. `document` selects the file naming/shape:
    "A44" -> prices_<zone>.csv, "A65" -> load_<zone>.csv."""

    def __init__(self, csv_dir, org_id, document="A44"):
        self.dir = csv_dir
        self.org_id = org_id or "NO_ORG"
        self.document = document
        os.makedirs(csv_dir, exist_ok=True)

    def _path(self, zone):
        prefix = "load" if self.document == "A65" else "prices"
        return os.path.join(self.dir, f"{prefix}_{zone.lower()}.csv")

    def max_timestamp(self, zone):
        """Resume point: last row's timestamp in the CSV, or None."""
        path = self._path(zone)
        if not os.path.exists(path):
            return None
        last = None
        with open(path, newline="") as fh:
            for row in csv.reader(fh):
                if row and row[0] != "timestamp":
                    last = row[0]
        return _parse_dt(last) if last else None

    def upsert(self, zone, rows):
        path = self._path(zone)
        exists = os.path.exists(path) and os.path.getsize(path) > 0
        with open(path, "a", newline="") as fh:
            w = csv.writer(fh)
            if not exists:
                if self.document == "A65":
                    w.writerow(["timestamp", "zone", "load_mw", "source"])
                else:
                    w.writerow(["timestamp", "zone", "product",
                                "price_eur_mwh", "source"])
            for hour, value in rows:
                if self.document == "A65":
                    w.writerow([hour.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                zone, value, SOURCE])
                else:
                    w.writerow([hour.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                zone, PRODUCT, value, SOURCE])
        return len(rows)


# ---------------------------------------------------------------------------
# Backfill driver
# ---------------------------------------------------------------------------

def backfill_zone(zone, token, start, end, sink, delay, retries,
                  allow_resume=True, zones_map=None, document_type="A44"):
    """Backfill one zone; returns a summary dict. Raises EntsoeError on fatal."""
    zones_map = zones_map or ZONES
    eic, _default_years = zones_map[zone]
    eff_start = start

    if allow_resume:
        resume_from = sink.max_timestamp(zone)
        if resume_from is not None:
            nxt = resume_from + timedelta(hours=1)
            if nxt > eff_start:
                log.info("[%s] resume: existing data up to %s, continuing from %s",
                         zone, resume_from.isoformat(), nxt.isoformat())
                eff_start = nxt

    if eff_start >= end:
        log.info("[%s] nothing to do: range already covered up to %s",
                 zone, end.isoformat())
        return {"zone": zone, "hours": 0, "first": None, "last": None, "gaps": 0}

    session = requests.Session()
    all_rows = []
    for chunk_start, chunk_end in month_chunks(eff_start, end):
        rows = fetch_month(token, eic, chunk_start, chunk_end, retries,
                           session=session, document_type=document_type)
        all_rows.extend(rows)
        log.info("[%s] %s..%s -> %d hourly rows (total %d)",
                 zone, chunk_start.strftime("%Y-%m"),
                 chunk_end.strftime("%Y-%m"), len(rows), len(all_rows))
        time.sleep(delay)

    # De-duplicate hours (a month boundary can repeat an hour across chunks)
    # and drop anything before the effective start (overlapping responses
    # must not duplicate rows when appending to a CSV in resume mode).
    by_hour = {}
    for hour, price in all_rows:
        if hour >= eff_start:
            by_hour[hour] = price
    rows = sorted(by_hour.items())

    upserted = sink.upsert(zone, rows) if rows else 0

    first = rows[0][0] if rows else None
    last = rows[-1][0] if rows else None
    gaps = 0
    if first is not None:
        expected = int((last - first).total_seconds() // 3600) + 1
        gaps = expected - len(rows)

    log.info("[%s] DONE: %d hours upserted, %s .. %s, missing hours (gaps): %d",
             zone, upserted,
             first.isoformat() if first else "-",
             last.isoformat() if last else "-",
             gaps)
    return {"zone": zone, "hours": upserted, "first": first, "last": last,
            "gaps": gaps}


# ---------------------------------------------------------------------------
# --check-token
# ---------------------------------------------------------------------------

def check_token(token, retries, document_type="A44"):
    """Single 1-day HU request; print a verdict and exit."""
    eic = ZONES["HU"][0]
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=1)
    log.info("check-token: 1-day HU %s request against %s ...",
             document_type, API_URL)
    try:
        rows = fetch_month(token, eic, start, now, retries,
                           document_type=document_type)
    except EntsoeError as exc:
        # Retries exhausted on HTTP errors / HTML bodies.
        print(f"VERDICT: platform unavailable, try later ({exc})")
        return 2
    if rows:
        what = "load values" if document_type == "A65" else "hourly prices"
        print(f"VERDICT: token OK - received {len(rows)} {what} for HU "
              f"({rows[0][0].isoformat()} .. {rows[-1][0].isoformat()})")
        return 0
    # Valid XML but no prices: could be an Acknowledgement_MarketDocument.
    # Re-fetch raw to inspect the Reason code (single extra request).
    params = {
        "securityToken": token,
        "documentType": document_type,
        "in_Domain": eic,
        "out_Domain": eic,
        "periodStart": _format_period(start),
        "periodEnd": _format_period(now),
    }
    try:
        resp = requests.get(API_URL, params=params,
                            headers={"Accept": "application/xml"}, timeout=60)
        root = ET.fromstring(resp.text)
        doc_type = None
        reason = None
        for el in root.iter():
            name = _local_name(el.tag)
            if name == "type" and doc_type is None:
                doc_type = (el.text or "").strip()
            elif name == "Reason":
                code = text = None
                for ch in el:
                    cname = _local_name(ch.tag)
                    if cname == "code":
                        code = (ch.text or "").strip()
                    elif cname == "text":
                        text = (ch.text or "").strip()
                reason = (code, text)
                break
        if doc_type == "Acknowledgement_MarketDocument" or reason:
            code, text = reason or (None, None)
            print(f"VERDICT: token rejected: {code or '?'} {text or ''}".rstrip())
            return 1
        print("VERDICT: valid XML but no prices returned "
              f"(document type: {doc_type or '?'}); token appears accepted "
              "but no data in the window")
        return 0
    except Exception as exc:
        print(f"VERDICT: platform unavailable, try later ({exc})")
        return 2


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="One-time ENTSO-E historical backfill: day-ahead prices "
                    "(A44, default) into market_price_history (HU 15y, RS 8y, "
                    "MK 2y) or actual total load (A65) into load_history "
                    "(MK 4y, HU 10y, RS 8y).")
    ap.add_argument("--document", choices=["A44", "A65"], default="A44",
                    help="ENTSO-E documentType: A44 = day-ahead prices "
                         "(default), A65 = actual total load")
    ap.add_argument("--org-id", default=os.environ.get("ORG_ID"),
                    help="organization UUID (or env ORG_ID)")
    ap.add_argument("--zones", default="HU,RS,MK",
                    help="comma-separated price zones for --document A44 "
                         "(default HU,RS,MK)")
    ap.add_argument("--load-zones", default="MK,HU,RS",
                    help="comma-separated load zones for --document A65 "
                         "(default MK,HU,RS; windows MK 4y / HU 10y / RS 8y)")
    ap.add_argument("--years", type=int, default=None,
                    help="override lookback years for all zones")
    ap.add_argument("--start", default=None,
                    help="start date YYYY-MM-DD (disables resume)")
    ap.add_argument("--end", default=None,
                    help="end date YYYY-MM-DD (default: today, UTC)")
    ap.add_argument("--token", default=os.environ.get("ENTSOE_API_TOKEN"),
                    help="ENTSO-E token (or env ENTSOE_API_TOKEN)")
    ap.add_argument("--delay", type=float, default=2.0,
                    help="seconds between requests (default 2.0)")
    ap.add_argument("--retries", type=int, default=8,
                    help="retry attempts per request (default 8)")
    ap.add_argument("--csv-dir", default="./backfill_out",
                    help="CSV output dir when Supabase env vars are absent "
                         "(default ./backfill_out)")
    ap.add_argument("--check-token", action="store_true",
                    help="single 1-day HU request, print verdict, exit")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    if not args.token:
        ap.error("ENTSO-E token required: --token or env ENTSOE_API_TOKEN")

    if args.check_token:
        sys.exit(check_token(args.token, args.retries,
                             document_type=args.document))

    is_load = args.document == "A65"
    zones_map = LOAD_ZONES if is_load else ZONES
    table = LOAD_TABLE if is_load else TABLE

    # Storage mode
    sb_url = os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if sb_url and sb_key:
        if not args.org_id:
            ap.error("--org-id (or env ORG_ID) required in Supabase mode")
        sink = SupabaseSink(sb_url, sb_key, args.org_id,
                            document=args.document)
        log.info("Storage mode: Supabase %s (table %s, org %s)",
                 sb_url, table, args.org_id)
    else:
        sink = CsvSink(args.csv_dir, args.org_id, document=args.document)
        log.warning("******************************************************")
        log.warning("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set ->")
        log.warning("CSV MODE: writing per-zone files to %s instead", args.csv_dir)
        log.warning("******************************************************")

    zone_arg = args.load_zones if is_load else args.zones
    zones = [z.strip().upper() for z in zone_arg.split(",") if z.strip()]
    unknown = [z for z in zones if z not in zones_map]
    if unknown:
        ap.error(f"unknown zone(s): {','.join(unknown)} (known: {','.join(zones_map)})")

    end = (datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
           if args.end else datetime.now(timezone.utc))

    summaries, failures = [], []
    for zone in zones:
        if args.start:
            start = datetime.strptime(args.start, "%Y-%m-%d").replace(
                tzinfo=timezone.utc)
        else:
            years = args.years if args.years else zones_map[zone][1]
            start = end - timedelta(days=years * 365)
            start = start.replace(hour=0, minute=0, second=0, microsecond=0)

        log.info("=== zone %s (%s): backfill %s .. %s ===", zone,
                 args.document, start.date().isoformat(), end.date().isoformat())
        try:
            summaries.append(backfill_zone(
                zone, args.token, start, end, sink, args.delay, args.retries,
                allow_resume=args.start is None, zones_map=zones_map,
                document_type=args.document))
        except EntsoeError as exc:
            log.error("[%s] ZONE ABORTED: %s (continuing with other zones)",
                      zone, exc)
            failures.append(zone)

    log.info("================ SUMMARY ================")
    for s in summaries:
        log.info("%s: %d hours, %s .. %s, gaps: %d",
                 s["zone"], s["hours"],
                 s["first"].isoformat() if s["first"] else "-",
                 s["last"].isoformat() if s["last"] else "-",
                 s["gaps"])
    if failures:
        log.error("FAILED zones: %s", ",".join(failures))
        sys.exit(1)


if __name__ == "__main__":
    main()
