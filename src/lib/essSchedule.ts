/**
 * ESS (ENTSO-E Scheduling System) document builder — DtdVersion 3, Release 3.
 *
 * Produces the same ScheduleMessage structure MEPSO accepts:
 *   TPS — one ScheduleTimeSeries per schedulable trade (Trade Blotter) plus
 *         the consumption leg derived from balance_schedules (Scheduling &
 *         Nomination).
 *   PPS — one ScheduleTimeSeries per production metering point.
 *
 * Day boundary follows local midnight expressed in UTC (22:00Z–22:00Z in
 * CEST, 23:00Z–23:00Z in CET), resolution PT15M, 96 (or 92/100 on DST days)
 * quarter-hour positions, quantities in MW (MeasurementUnit MAW).
 */

export type EssSettings = {
  sender_eic: string;
  sender_role?: string;
  receiver_eic?: string;
  receiver_role?: string;
  default_area_eic?: string;
};

export type EssSeries = {
  seriesId: string;              // SendersTimeSeriesIdentification
  version?: number;
  businessType: string;          // A01 production | A02 internal | A03 external | A04 consumption
  objectAggregation: string;     // A02 metering point | A03 party | A04 area
  inArea?: string | null;
  outArea?: string | null;
  inParty?: string | null;
  outParty?: string | null;
  meteringPoint?: string | null;
  capacityContractType?: string | null;
  capacityAgreementId?: string | null;
  /** MW per quarter-hour position, index 0 = Pos 1 */
  quantities: number[];
};

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const el = (name: string, v: string | number, extra = "") =>
  `    <${name} v="${esc(String(v))}"${extra} />`;

/**
 * Quantity formatting per Правила за пазар на електрична енергија, чл. 3(2)(3):
 * active power in MW with three decimals, EXCEPT cross-border physical
 * schedule nominations, which must be whole numbers.
 */
export function fmtQty(n: number, integerOnly = false): string {
  if (integerOnly) return String(Math.round(n));
  return String(Math.round(n * 1000) / 1000);
}

/** Cross-border series (BusinessType A03) must carry integer MW values. */
export const isCrossBorder = (businessType: string) => businessType === "A03";

/**
 * Schedule day window in UTC for a local calendar date (Europe/Skopje).
 * Returns ISO strings without seconds, as ESS expects (…T22:00Z).
 */
export function scheduleWindow(dateISO: string, tz = "Europe/Skopje") {
  const localMidnight = (d: string) => {
    // Offset of the zone at that date, derived without external libs.
    const probe = new Date(`${d}T12:00:00Z`);
    const asTz = new Date(probe.toLocaleString("en-US", { timeZone: tz }));
    const asUtc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetMin = Math.round((asTz.getTime() - asUtc.getTime()) / 60000);
    return new Date(Date.parse(`${d}T00:00:00Z`) - offsetMin * 60000);
  };
  const next = new Date(Date.parse(`${dateISO}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const start = localMidnight(dateISO);
  const end = localMidnight(next);
  const iso = (d: Date) => d.toISOString().slice(0, 16) + "Z";
  const positions = Math.round((end.getTime() - start.getTime()) / 900000); // 96, or 92/100 on DST days
  return { start, end, interval: `${iso(start)}/${iso(end)}`, positions };
}

export function buildEssMessage(opts: {
  messageId: string;
  messageVersion: number;
  dateISO: string;
  settings: EssSettings;
  series: EssSeries[];
  messageDateTime?: Date;
}): string {
  const { messageId, messageVersion, dateISO, settings, series } = opts;
  const win = scheduleWindow(dateISO);
  const now = (opts.messageDateTime ?? new Date()).toISOString().slice(0, 19) + "Z";

  const head = [
    `<ScheduleMessage DtdVersion="3" DtdRelease="3">`,
    `  <MessageIdentification v="${esc(messageId)}" />`,
    `  <MessageVersion v="${messageVersion}" />`,
    `  <MessageType v="A01" />`,
    `  <ProcessType v="A01" />`,
    `  <ScheduleClassificationType v="A01" />`,
    `  <SenderIdentification v="${esc(settings.sender_eic)}" codingScheme="A01" />`,
    `  <SenderRole v="${settings.sender_role ?? "A01"}" />`,
    `  <ReceiverIdentification v="${esc(settings.receiver_eic ?? "10XMK-MEPSO----M")}" codingScheme="A01" />`,
    `  <ReceiverRole v="${settings.receiver_role ?? "A04"}" />`,
    `  <MessageDateTime v="${now}" />`,
    `  <ScheduleTimeInterval v="${win.interval}" />`,
  ];

  const body = series.map((s) => {
    const lines: string[] = [`  <ScheduleTimeSeries>`];
    lines.push(el("SendersTimeSeriesIdentification", s.seriesId));
    lines.push(el("SendersTimeSeriesVersion", s.version ?? 1));
    lines.push(el("BusinessType", s.businessType));
    lines.push(el("Product", "8716867000016"));
    lines.push(el("ObjectAggregation", s.objectAggregation));
    if (s.inArea) lines.push(el("InArea", s.inArea, ' codingScheme="A01"'));
    if (s.outArea) lines.push(el("OutArea", s.outArea, ' codingScheme="A01"'));
    if (s.meteringPoint) lines.push(el("MeteringPointIdentification", s.meteringPoint, ' codingScheme="A01"'));
    if (s.inParty) lines.push(el("InParty", s.inParty, ' codingScheme="A01"'));
    if (s.outParty) lines.push(el("OutParty", s.outParty, ' codingScheme="A01"'));
    if (s.capacityContractType) lines.push(el("CapacityContractType", s.capacityContractType));
    if (s.capacityAgreementId) lines.push(el("CapacityAgreementIdentification", s.capacityAgreementId));
    lines.push(el("MeasurementUnit", "MAW"));
    lines.push(`    <Period>`);
    lines.push(`      <TimeInterval v="${win.interval}" />`);
    lines.push(`      <Resolution v="PT15M" />`);
    for (let i = 0; i < win.positions; i++) {
      lines.push(`      <Interval>`);
      lines.push(`        <Pos v="${i + 1}" />`);
      lines.push(`        <Qty v="${fmtQty(s.quantities[i] ?? 0, isCrossBorder(s.businessType))}" />`);
      lines.push(`      </Interval>`);
    }
    lines.push(`    </Period>`);
    lines.push(`  </ScheduleTimeSeries>`);
    return lines.join("\r\n");
  });

  return [...head, ...body, `</ScheduleMessage>`].join("\r\n") + "\r\n";
}

/**
 * Expand a trade into MW-per-quarter-hour for the schedule day.
 * Flat block by default (volume / hours); an explicit mtu_shape wins.
 * Quantities fall outside the delivery window are zero.
 */
export function tradeQuantities(trade: any, dateISO: string): number[] {
  const win = scheduleWindow(dateISO);
  const n = win.positions;
  if (Array.isArray(trade.mtu_shape) && trade.mtu_shape.length) {
    return Array.from({ length: n }, (_, i) => Number(trade.mtu_shape[i] ?? 0));
  }
  const dStart = new Date(trade.delivery_start).getTime();
  const dEnd = new Date(trade.delivery_end).getTime();
  const hours = Math.max((dEnd - dStart) / 3600000, 0.25);
  const mw = Number(trade.volume_mwh || 0) / hours;
  return Array.from({ length: n }, (_, i) => {
    const t = win.start.getTime() + i * 900000;
    return t >= dStart && t < dEnd ? mw : 0;
  });
}

/** Derive ESS classification when the trade doesn't carry explicit values. */
export function classifyTrade(trade: any, homeArea: string) {
  const inArea = trade.in_area_eic || homeArea;
  const outArea = trade.out_area_eic || homeArea;
  const external = inArea !== outArea;
  return {
    businessType: trade.ess_business_type || (external ? "A03" : "A02"),
    objectAggregation: external ? "A04" : "A03",
    inArea,
    outArea,
    capacityContractType: external ? (trade.capacity_contract_type || "A04") : null,
  };
}

export function downloadXml(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
