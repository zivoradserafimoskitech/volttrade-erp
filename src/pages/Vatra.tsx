// @ts-nocheck
import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, Cell, ReferenceLine,
} from "recharts";

/* ───────────────────────── design tokens ─────────────────────────
   Brand: VATRA — "hearth". Ember palette, not generic eco-green.
------------------------------------------------------------------- */
const T = {
  bg: "#18140F",
  card: "#241E17",
  line: "#3A3128",
  ember: "#FF6B2C",
  amber: "#FFB454",
  ash: "#F5EFE6",
  dim: "#A89E8F",
  moss: "#4CAF8B",
  mossDark: "#2E6E54",
};

/* ───────────── household data ───────────── */
const hourlyHome = [
  { h: "00", kwh: 0.4, price: 38 }, { h: "02", kwh: 0.3, price: 31 },
  { h: "04", kwh: 0.3, price: 29 }, { h: "06", kwh: 0.8, price: 52 },
  { h: "08", kwh: 1.4, price: 78 }, { h: "10", kwh: 1.1, price: 61 },
  { h: "12", kwh: 0.9, price: 24 }, { h: "14", kwh: 1.0, price: 19 },
  { h: "16", kwh: 1.3, price: 47 }, { h: "18", kwh: 2.4, price: 112 },
  { h: "20", kwh: 2.1, price: 134 }, { h: "22", kwh: 1.2, price: 71 },
];
const monthlyHome = [
  { m: "Jan", kwh: 412 }, { m: "Feb", kwh: 376 }, { m: "Mar", kwh: 331 },
  { m: "Apr", kwh: 268 }, { m: "May", kwh: 245 }, { m: "Jun", kwh: 224 },
];
const breakdownHome = [
  { name: "Heating & AC", pct: 38, kwh: 85 },
  { name: "Water heating", pct: 21, kwh: 47 },
  { name: "Kitchen", pct: 17, kwh: 38 },
  { name: "Lighting & devices", pct: 14, kwh: 31 },
  { name: "Other", pct: 10, kwh: 23 },
];

/* ───────────── business data ───────────── */
const hourlyBiz = [
  { h: "00", kwh: 6, price: 38 }, { h: "02", kwh: 5, price: 31 },
  { h: "04", kwh: 7, price: 29 }, { h: "06", kwh: 18, price: 52 },
  { h: "08", kwh: 42, price: 78 }, { h: "10", kwh: 51, price: 61 },
  { h: "12", kwh: 47, price: 24 }, { h: "14", kwh: 49, price: 19 },
  { h: "16", kwh: 44, price: 47 }, { h: "18", kwh: 28, price: 112 },
  { h: "20", kwh: 12, price: 134 }, { h: "22", kwh: 8, price: 71 },
];
const monthlyBiz = [
  { m: "Jan", kwh: 8420 }, { m: "Feb", kwh: 7980 }, { m: "Mar", kwh: 8110 },
  { m: "Apr", kwh: 7640 }, { m: "May", kwh: 7890 }, { m: "Jun", kwh: 7320 },
];
const sites = [
  { name: "Workshop — Vrapčište", kw: 38.2, kwh: 4120, share: 56, status: "ok" },
  { name: "Cold storage — Gostivar", kw: 16.8, kwh: 2240, share: 31, status: "peak" },
  { name: "Office — Tetovo", kw: 4.1, kwh: 960, share: 13, status: "ok" },
];
const peakProfile = [
  { d: "W1", kw: 52 }, { d: "W2", kw: 58 }, { d: "W3", kw: 61 },
  { d: "W4", kw: 73 }, { d: "W5", kw: 64 }, { d: "W6", kw: 59 },
];

/* cold storage site: grid draw today vs. with hosted solar+battery */
const assessProfile = [
  { h: "00", before: 9, after: 9 },   { h: "02", before: 8, after: 8 },
  { h: "04", before: 8, after: 8 },   { h: "06", before: 11, after: 11 },
  { h: "08", before: 14, after: 8 },  { h: "10", before: 15, after: 2 },
  { h: "12", before: 16, after: 0 },  { h: "14", before: 26, after: 4 },
  { h: "16", before: 22, after: 6 },  { h: "18", before: 17, after: 7 },
  { h: "20", before: 13, after: 6 },  { h: "22", before: 10, after: 9 },
];

const savingsStack = [
  { name: "Peak shaving — avoided demand charges", val: 110 },
  { name: "Solar self-supply below grid price", val: 95 },
  { name: "Battery discharge in 18–21h peak prices", val: 60 },
];

/* business subscription tiers */
const plans = [
  {
    id: "insight", name: "Insight", price: 0, unit: "included with supply",
    tag: null,
    features: [
      "15-min metering on every site",
      "Live dashboards & day-ahead price signals",
      "Monthly consumption reports",
    ],
  },
  {
    id: "optimize", name: "Optimize", price: 49, unit: "€/mo per site",
    tag: "Most popular",
    features: [
      "Everything in Insight",
      "Peak-demand alarms & contracted-power advisory",
      "Automated load shifting (relay / API control)",
      "ESG & CO₂ reports, audit-ready export",
      "Quarterly tariff optimization review",
    ],
  },
  {
    id: "hearth", name: "Hearth", price: 390, unit: "€/mo per site",
    tag: "Energy-as-a-Service",
    features: [
      "Everything in Optimize",
      "Hosted rooftop solar + battery — we build, own, operate",
      "Guaranteed savings floor: net benefit ≥ 150 €/mo or we credit the gap",
      "Maintenance, insurance, monitoring included",
      "10-yr term · buyout option at residual value",
    ],
  },
];

/* consumption packs — flat monthly fee for a kWh bundle */
const packsHome = [
  {
    id: "s", name: "Pack S", kwh: 200, price: 19,
    fit: "Apartments, 1–2 people",
    perks: ["Unused kWh roll over (up to 100)", "Overage at 0.115 €/kWh"],
  },
  {
    id: "m", name: "Pack M", kwh: 350, price: 31, tag: "Your fit",
    fit: "Family homes",
    perks: ["Unused kWh roll over (up to 175)", "Free midday kWh: 12–16h usage doesn't count", "Overage at 0.105 €/kWh"],
  },
  {
    id: "l", name: "Pack L", kwh: 550, price: 46,
    fit: "Large homes, EV or heat pump",
    perks: ["Unused kWh roll over (up to 275)", "Free midday kWh: 12–16h usage doesn't count", "EV night window at half rate", "Overage at 0.098 €/kWh"],
  },
];

const packsBiz = [
  {
    id: "b1", name: "Pack 5", kwh: 5000, price: 410,
    fit: "Offices, retail",
    perks: ["Unused kWh roll over (up to 2,500)", "Overage at 0.095 €/kWh"],
  },
  {
    id: "b2", name: "Pack 10", kwh: 10000, price: 780, tag: "Your fit",
    fit: "Workshops, light industry",
    perks: ["Unused kWh roll over (up to 5,000)", "Free midday kWh: 11–16h usage doesn't count", "Overage at 0.089 €/kWh"],
  },
  {
    id: "b3", name: "Pack 25", kwh: 25000, price: 1850,
    fit: "Cold storage, production",
    perks: ["Unused kWh roll over (up to 12,500)", "Free midday kWh: 11–16h usage doesn't count", "Dedicated account engineer", "Overage at 0.082 €/kWh"],
  },
];

/* ───────────── invest data ───────────── */
const projects = [
  {
    id: 1, name: "Ovche Pole Solar", type: "Solar PV · 12 MWp",
    location: "Sveti Nikole, MK", yield: "7.2%", term: "7 yr",
    raised: 84, min: 50, minBiz: 1000, badge: "Producing",
  },
  {
    id: 2, name: "Vardar Storage I", type: "Battery storage · 4 MW / 16 MWh",
    location: "Veles, MK", yield: "9.1%", term: "7 yr",
    raised: 47, min: 100, minBiz: 2500, badge: "Funding",
  },
  {
    id: 3, name: "Banat Wind Repower", type: "Wind · 18 MW",
    location: "Timiș, RO", yield: "6.8%", term: "10 yr",
    raised: 12, min: 50, minBiz: 1000, badge: "New",
  },
];

const ic = {
  flame: (c) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 2c1 4-4 5.5-4 10a6 6 0 0 0 12 0c0-2.5-1.5-4-2.5-5.5-.5 1.5-1.5 2-2.5 2 .8-2.5-.5-5-3-6.5z"
        stroke={c} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  chart: (c) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  leaf: (c) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M6 18C6 10 12 5 20 4c1 8-3 15-11 15-1.2 0-2.2-.3-3-.8M6 18c0 0-1 1.5-1.5 3M6 18c2-4 5-7 9-9"
        stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  user: (c) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke={c} strokeWidth="1.7" />
      <path d="M4.5 20c1.2-3.2 4-5 7.5-5s6.3 1.8 7.5 5" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  qr: (c) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.7" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.7" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.7" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3z" stroke={c} strokeWidth="1.7" />
    </svg>
  ),
};

/* ───────────── shared bits ───────────── */
const Card = ({ children, style }) => (
  <div style={{
    background: T.card, border: `1px solid ${T.line}`,
    borderRadius: 18, padding: 16, ...style,
  }}>{children}</div>
);

const Eyebrow = ({ children, color = T.dim }) => (
  <div style={{
    fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
    color, fontWeight: 600, marginBottom: 6,
  }}>{children}</div>
);

const ChartTip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.bg, border: `1px solid ${T.line}`, borderRadius: 10,
      padding: "6px 10px", fontSize: 12, color: T.ash,
    }}>
      <span style={{ color: T.dim }}>{label} · </span>
      {payload[0].value} {unit}
    </div>
  );
};

const StatPair = ({ a, b }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
    {[a, b].map((s, i) => (
      <Card key={i}>
        <Eyebrow>{s.label}</Eyebrow>
        <div style={{
          fontSize: 22, fontWeight: 700, color: s.color || T.ash,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>{s.value}</div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>{s.sub}</div>
      </Card>
    ))}
  </div>
);

const PriceCurve = () => (
  <Card>
    <Eyebrow>Day-ahead price · €/MWh</Eyebrow>
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={hourlyHome} margin={{ top: 6, right: 0, left: -28, bottom: 0 }}>
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.amber} stopOpacity={0.5} />
            <stop offset="100%" stopColor={T.amber} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="h" tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTip unit="€/MWh" />} />
        <Area type="monotone" dataKey="price" stroke={T.amber} strokeWidth={2} fill="url(#priceGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  </Card>
);

const Signal = ({ title, body, tone = "moss" }) => {
  const c = tone === "moss" ? T.moss : T.ember;
  const bg = tone === "moss" ? T.mossDark : T.ember;
  return (
    <Card style={{ background: `linear-gradient(135deg, ${bg}33, ${T.card})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 12, background: `${c}22`,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{tone === "moss" ? ic.leaf(c) : ic.flame(c)}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ash }}>{title}</div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 2 }}>{body}</div>
        </div>
      </div>
    </Card>
  );
};

/* ───────────── HOME (household) ───────────── */
function HomeHousehold({ onPacks }) {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => p + 1), 2200);
    return () => clearInterval(id);
  }, []);
  const liveKw = (1.62 + 0.13 * Math.sin(pulse)).toFixed(2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ textAlign: "center", padding: "26px 16px 22px", position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: `radial-gradient(circle at 50% 115%, ${T.ember}33 0%, transparent 55%)`,
        }} />
        <Eyebrow>Drawing now</Eyebrow>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: 52, fontWeight: 700,
          color: T.ash, lineHeight: 1, letterSpacing: "-0.02em",
        }}>
          {liveKw}<span style={{ fontSize: 20, color: T.dim, fontWeight: 500 }}> kW</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 13, color: T.dim }}>
          Today so far: <span style={{ color: T.ash, fontWeight: 600 }}>11.8 kWh · 1.94 €</span>
        </div>
      </Card>

      <Signal
        title="Cheap power until 16:00"
        body="Solar surplus on the grid — 19 €/MWh. Midday kWh are free on your pack right now."
      />

      {/* pack status */}
      <Card style={{ cursor: "pointer" }} >
        <div onClick={onPacks}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <Eyebrow color={T.amber}>Pack M · 31 €/mo flat</Eyebrow>
            <span style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>Manage ›</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: T.ash,
            }}>168</span>
            <span style={{ fontSize: 12, color: T.dim }}>/ 350 kWh used · 17 days left</span>
          </div>
          <div style={{ height: 7, background: T.line, borderRadius: 4, marginTop: 8 }}>
            <div style={{
              height: "100%", width: "48%", borderRadius: 4,
              background: `linear-gradient(90deg, ${T.amber}, ${T.ember})`,
            }} />
          </div>
          <div style={{ fontSize: 11, color: T.dim, marginTop: 7 }}>
            On pace for 310 kWh — inside your pack. 41 free midday kWh earned.
          </div>
        </div>
      </Card>
      <PriceCurve />
      <StatPair
        a={{ label: "vs. last month", value: "−8.6%", sub: "You're using less", color: T.moss }}
        b={{ label: "Green share", value: "64%", sub: "Of your supply this month" }}
      />
    </div>
  );
}

/* ───────────── HOME (business) ───────────── */
function HomeBusiness() {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => p + 1), 2200);
    return () => clearInterval(id);
  }, []);
  const liveKw = (59.1 + 2.4 * Math.sin(pulse)).toFixed(1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ textAlign: "center", padding: "24px 16px 20px", position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: `radial-gradient(circle at 50% 115%, ${T.ember}33 0%, transparent 55%)`,
        }} />
        <Eyebrow>All sites · drawing now</Eyebrow>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: 48, fontWeight: 700,
          color: T.ash, lineHeight: 1, letterSpacing: "-0.02em",
        }}>
          {liveKw}<span style={{ fontSize: 19, color: T.dim, fontWeight: 500 }}> kW</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 13, color: T.dim }}>
          Today so far: <span style={{ color: T.ash, fontWeight: 600 }}>312 kWh · 24.70 €</span>
        </div>
      </Card>

      <Signal
        tone="ember"
        title="Peak demand at 91% of contracted"
        body="Cold storage hit 73 kW this week against 80 kW contracted. Exceeding it triggers penalty charges."
      />

      {/* sites */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px 8px" }}>
          <Eyebrow>Sites · live</Eyebrow>
        </div>
        {sites.map((s, i) => (
          <div key={s.name} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 16px",
            borderTop: i > 0 ? `1px solid ${T.line}` : "none",
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ash }}>{s.name}</div>
              <div style={{ fontSize: 11, color: T.dim, marginTop: 1 }}>{s.kwh.toLocaleString()} kWh this month · {s.share}%</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{
                fontSize: 15, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
                color: s.status === "peak" ? T.ember : T.ash,
              }}>{s.kw} kW</div>
              {s.status === "peak" && (
                <div style={{ fontSize: 10, color: T.ember, fontWeight: 600 }}>near peak</div>
              )}
            </div>
          </div>
        ))}
      </Card>

      <PriceCurve />
      <StatPair
        a={{ label: "Energy cost / unit", value: "0.071 €", sub: "Blended €/kWh, this month" }}
        b={{ label: "Load in cheap hours", value: "47%", sub: "10:00–16:00 share", color: T.moss }}
      />
    </div>
  );
}

/* ───────────── USAGE ───────────── */
function Usage({ biz }) {
  const [range, setRange] = useState("day");
  const hourly = biz ? hourlyBiz : hourlyHome;
  const monthly = biz ? monthlyBiz : monthlyHome;
  const maxPrice = Math.max(...hourly.map((d) => d.price));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["day", "month"].map((r) => (
          <button key={r} onClick={() => setRange(r)} style={{
            flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 13, fontWeight: 600,
            border: `1px solid ${range === r ? T.ember : T.line}`,
            background: range === r ? `${T.ember}1A` : "transparent",
            color: range === r ? T.ember : T.dim, cursor: "pointer",
          }}>
            {r === "day" ? "Today" : "6 months"}
          </button>
        ))}
      </div>

      <Card>
        <Eyebrow>{range === "day" ? "Consumption by hour · kWh" : "Monthly consumption · kWh"}</Eyebrow>
        <ResponsiveContainer width="100%" height={170}>
          {range === "day" ? (
            <BarChart data={hourly} margin={{ top: 6, right: 0, left: -24, bottom: 0 }}>
              <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="h" tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip unit="kWh" />} cursor={{ fill: `${T.ash}08` }} />
              <Bar dataKey="kwh" radius={[4, 4, 0, 0]}>
                {hourly.map((d, i) => (
                  <Cell key={i} fill={d.price / maxPrice > 0.6 ? T.ember : d.price / maxPrice > 0.35 ? T.amber : "#6E6354"} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={monthly} margin={{ top: 6, right: 0, left: -16, bottom: 0 }}>
              <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="m" tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip unit="kWh" />} cursor={{ fill: `${T.ash}08` }} />
              <Bar dataKey="kwh" fill={T.amber} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
        {range === "day" && (
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 10, color: T.dim }}>
            <span><span style={{ color: T.ember }}>●</span> Peak price</span>
            <span><span style={{ color: T.amber }}>●</span> Mid</span>
            <span><span style={{ color: "#6E6354" }}>●</span> Cheap</span>
          </div>
        )}
      </Card>

      {biz ? (
        <>
          {/* peak demand tracker */}
          <Card>
            <Eyebrow>Weekly peak demand · kW</Eyebrow>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={peakProfile} margin={{ top: 10, right: 0, left: -24, bottom: 0 }}>
                <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="d" tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 90]} tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip unit="kW" />} cursor={{ fill: `${T.ash}08` }} />
                <ReferenceLine y={80} stroke={T.ember} strokeDasharray="4 4"
                  label={{ value: "contracted 80 kW", fill: T.ember, fontSize: 10, position: "insideTopRight" }} />
                <Bar dataKey="kw" radius={[4, 4, 0, 0]}>
                  {peakProfile.map((d, i) => (
                    <Cell key={i} fill={d.kw > 70 ? T.ember : T.amber} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card style={{ background: `linear-gradient(135deg, ${T.ember}1F, ${T.card})` }}>
            <div style={{ fontSize: 13, color: T.ash, fontWeight: 600 }}>Stagger compressor starts at the cold storage</div>
            <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>
              Week 4 peak was driven by simultaneous compressor restarts after the 14:00 defrost cycle. Staggering them by 10 min keeps you under 80 kW. Estimated avoided demand charges: ~110 €/month.
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <Eyebrow>Where it goes · this month</Eyebrow>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
              {breakdownHome.map((b) => (
                <div key={b.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                    <span style={{ color: T.ash }}>{b.name}</span>
                    <span style={{ color: T.dim }}>{b.kwh} kWh</span>
                  </div>
                  <div style={{ height: 6, background: T.line, borderRadius: 3 }}>
                    <div style={{
                      height: "100%", width: `${b.pct * 2.2}%`, maxWidth: "100%",
                      background: `linear-gradient(90deg, ${T.amber}, ${T.ember})`, borderRadius: 3,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card style={{ background: `linear-gradient(135deg, ${T.ember}1F, ${T.card})` }}>
            <div style={{ fontSize: 13, color: T.ash, fontWeight: 600 }}>Shift 2 kWh of evening use to midday</div>
            <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>
              Your 18–21h usage costs 5× the midday rate. Estimated saving: ~7 €/month.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ───────────── INVEST ───────────── */
function Invest({ biz, onAssess }) {
  const [invested, setInvested] = useState({});
  const badgeColor = { Producing: T.moss, Funding: T.amber, New: T.ember };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ background: `linear-gradient(150deg, ${T.mossDark}55, ${T.card})` }}>
        <Eyebrow color={T.moss}>{biz ? "Company green portfolio" : "Your green portfolio"}</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, fontWeight: 700, color: T.ash,
          }}>{biz ? "18,500 €" : "1,250 €"}</span>
          <span style={{ fontSize: 13, color: T.moss, fontWeight: 600 }}>{biz ? "+1,240 € earned" : "+86 € earned"}</span>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12, color: T.dim }}>
          <div><span style={{ color: T.ash, fontWeight: 600 }}>{biz ? "6.1 MWh" : "418 kWh"}</span> produced for you /mo</div>
          <div><span style={{ color: T.ash, fontWeight: 600 }}>{biz ? "4.6 t" : "312 kg"}</span> CO₂ avoided</div>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: T.dim }}>
          {biz
            ? "Earnings offset your invoices. CO₂ figures are export-ready for ESG and CBAM reporting."
            : "Earnings are paid out as credit on your electricity bill."}
        </div>
      </Card>

      {biz && (
        <Card style={{ background: `linear-gradient(135deg, ${T.ember}26, ${T.card})`, border: `1px solid ${T.ember}55` }}>
          <Eyebrow color={T.ember}>For your sites</Eyebrow>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ash }}>Host solar + a battery on your roof</div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 4, lineHeight: 1.5 }}>
            We finance, build, and operate it. You buy the output below grid price and shave your peak demand — no capex, 10-year supply contract.
          </div>
          <button onClick={onAssess} style={{
            marginTop: 12, width: "100%", padding: "11px 0", borderRadius: 12, border: "none",
            background: T.ember, color: "#18140F", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>Request site assessment</button>
        </Card>
      )}

      <Eyebrow>Open projects</Eyebrow>
      {projects.map((p) => {
        const min = biz ? p.minBiz : p.min;
        return (
          <Card key={p.id} style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.ash }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: T.dim, marginTop: 2 }}>{p.type} · {p.location}</div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: badgeColor[p.badge], background: `${badgeColor[p.badge]}1A`,
                  border: `1px solid ${badgeColor[p.badge]}44`,
                  padding: "3px 8px", borderRadius: 99,
                }}>{p.badge}</span>
              </div>

              <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: T.amber, fontFamily: "'Space Grotesk', sans-serif" }}>{p.yield}</div>
                  <div style={{ fontSize: 10, color: T.dim }}>target yield / yr</div>
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: T.ash, fontFamily: "'Space Grotesk', sans-serif" }}>{p.term}</div>
                  <div style={{ fontSize: 10, color: T.dim }}>term</div>
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: T.ash, fontFamily: "'Space Grotesk', sans-serif" }}>{min.toLocaleString()} €</div>
                  <div style={{ fontSize: 10, color: T.dim }}>minimum</div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.dim, marginBottom: 5 }}>
                  <span>Funded</span><span>{p.raised}%</span>
                </div>
                <div style={{ height: 6, background: T.line, borderRadius: 3 }}>
                  <div style={{
                    height: "100%", width: `${p.raised}%`, borderRadius: 3,
                    background: `linear-gradient(90deg, ${T.moss}, ${T.amber})`,
                  }} />
                </div>
              </div>
            </div>
            <button
              onClick={() => setInvested((s) => ({ ...s, [p.id]: !s[p.id] }))}
              style={{
                width: "100%", padding: "12px 0", border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700,
                background: invested[p.id] ? `${T.moss}22` : T.ember,
                color: invested[p.id] ? T.moss : "#18140F",
                transition: "background 0.2s",
              }}>
              {invested[p.id] ? "✓ Added to portfolio" : `Invest from ${min.toLocaleString()} €`}
            </button>
          </Card>
        );
      })}

      <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.5, padding: "0 4px" }}>
        Capital at risk. Target yields are projections, not guarantees. Mockup — not an offer of securities.
      </div>
    </div>
  );
}

/* ───────────── PACKS (consumption subscription) ───────────── */
function Packs({ biz, onBack }) {
  const data = biz ? packsBiz : packsHome;
  const fitId = biz ? "b2" : "m";
  const [sel, setSel] = useState(fitId);
  const [confirmed, setConfirmed] = useState(false);
  const current = data.find((p) => p.id === sel);
  const used = biz ? 7320 : 168;
  const cur = data.find((p) => p.id === fitId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} style={{
          width: 32, height: 32, borderRadius: 10, border: `1px solid ${T.line}`,
          background: T.card, color: T.ash, cursor: "pointer", fontSize: 15, lineHeight: 1,
        }}>‹</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ash }}>Electricity packs</div>
          <div style={{ fontSize: 11, color: T.dim }}>
            One flat price, a bundle of kWh. No surprises on the invoice.
          </div>
        </div>
      </div>

      {/* current usage against pack */}
      <Card style={{ background: `linear-gradient(150deg, ${T.ember}1C, ${T.card})` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Eyebrow color={T.ember}>This month · {cur.name}</Eyebrow>
          <span style={{ fontSize: 11, color: T.dim }}>17 days left</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 30, fontWeight: 700, color: T.ash,
          }}>{used.toLocaleString()}</span>
          <span style={{ fontSize: 13, color: T.dim }}>/ {cur.kwh.toLocaleString()} kWh used</span>
        </div>
        <div style={{ height: 8, background: T.line, borderRadius: 4, marginTop: 10 }}>
          <div style={{
            height: "100%", width: `${Math.min((used / cur.kwh) * 100, 100)}%`, borderRadius: 4,
            background: `linear-gradient(90deg, ${T.amber}, ${T.ember})`,
          }} />
        </div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 8 }}>
          On pace for {biz ? "9,150" : "310"} kWh — inside your pack. {biz ? "" : "Plus 41 free midday kWh so far."}
        </div>
      </Card>

      {data.map((p) => {
        const active = sel === p.id;
        const eff = (p.price / p.kwh).toFixed(3);
        return (
          <Card
            key={p.id}
            style={{
              cursor: "pointer", position: "relative",
              border: `1px solid ${active ? T.ember : T.line}`,
              background: active ? `linear-gradient(150deg, ${T.ember}1C, ${T.card})` : T.card,
            }}
          >
            <div onClick={() => { setSel(p.id); setConfirmed(false); }}>
              {p.tag && (
                <span style={{
                  position: "absolute", top: -9, right: 14,
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "#18140F", background: T.amber, padding: "3px 9px", borderRadius: 99,
                }}>{p.tag}</span>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <span style={{
                    fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: T.ash,
                  }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: T.dim, marginLeft: 8 }}>{p.fit}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{
                    fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700,
                    color: active ? T.ember : T.ash,
                  }}>{p.price.toLocaleString()} €</span>
                  <div style={{ fontSize: 10, color: T.dim }}>/month</div>
                </div>
              </div>
              <div style={{
                marginTop: 6, fontSize: 12, color: T.ash, fontWeight: 600,
              }}>
                {p.kwh.toLocaleString()} kWh included
                <span style={{ color: T.dim, fontWeight: 400 }}> · effectively {eff} €/kWh</span>
              </div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                {p.perks.map((f) => (
                  <div key={f} style={{ display: "flex", gap: 8, fontSize: 12, color: T.dim, lineHeight: 1.45 }}>
                    <span style={{ color: T.amber, flexShrink: 0 }}>✓</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        );
      })}

      <button
        onClick={() => setConfirmed(true)}
        style={{
          width: "100%", padding: "14px 0", borderRadius: 14, border: "none", cursor: "pointer",
          fontSize: 14, fontWeight: 700,
          background: confirmed ? `${T.moss}22` : T.ember,
          color: confirmed ? T.moss : "#18140F",
          transition: "background 0.2s",
        }}>
        {confirmed
          ? `✓ Switched to ${current.name} from next billing cycle`
          : sel === fitId ? `Keep ${current.name}` : `Switch to ${current.name}`}
      </button>

      <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.5, padding: "0 4px" }}>
        Prices incl. network fees{biz ? ", ex-VAT" : ""}. Free midday kWh applies while grid solar surplus conditions hold. Switch packs once per month. Mockup.
      </div>
    </div>
  );
}

/* ───────────── PLANS (business subscription) ───────────── */
function Plans({ onBack }) {
  const [sel, setSel] = useState("optimize");
  const [confirmed, setConfirmed] = useState(false);
  const current = plans.find((p) => p.id === sel);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} style={{
          width: 32, height: 32, borderRadius: 10, border: `1px solid ${T.line}`,
          background: T.card, color: T.ash, cursor: "pointer", fontSize: 15, lineHeight: 1,
        }}>‹</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ash }}>Business plans</div>
          <div style={{ fontSize: 11, color: T.dim }}>Per site · cancel Insight/Optimize anytime · Hearth is a 10-yr term</div>
        </div>
      </div>

      {plans.map((p) => {
        const active = sel === p.id;
        return (
          <Card
            key={p.id}
            style={{
              cursor: "pointer", position: "relative",
              border: `1px solid ${active ? T.ember : T.line}`,
              background: active ? `linear-gradient(150deg, ${T.ember}1C, ${T.card})` : T.card,
            }}
          >
            <div onClick={() => { setSel(p.id); setConfirmed(false); }}>
              {p.tag && (
                <span style={{
                  position: "absolute", top: -9, right: 14,
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "#18140F", background: p.id === "hearth" ? T.moss : T.amber,
                  padding: "3px 9px", borderRadius: 99,
                }}>{p.tag}</span>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{
                  fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: T.ash,
                }}>{p.name}</div>
                <div style={{ textAlign: "right" }}>
                  <span style={{
                    fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700,
                    color: active ? T.ember : T.ash,
                  }}>{p.price === 0 ? "0 €" : `${p.price} €`}</span>
                  <div style={{ fontSize: 10, color: T.dim }}>{p.unit}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {p.features.map((f) => (
                  <div key={f} style={{ display: "flex", gap: 8, fontSize: 12, color: T.dim, lineHeight: 1.45 }}>
                    <span style={{ color: p.id === "hearth" ? T.moss : T.amber, flexShrink: 0 }}>✓</span>
                    <span style={{ color: f.startsWith("Everything") ? T.dim : T.ash }}>{f}</span>
                  </div>
                ))}
              </div>
              {p.id === "hearth" && (
                <div style={{
                  marginTop: 10, padding: "9px 12px", borderRadius: 10,
                  background: `${T.moss}14`, border: `1px solid ${T.moss}33`,
                  fontSize: 11, color: T.dim, lineHeight: 1.5,
                }}>
                  Your cold storage site: gross benefit ≈ <span style={{ color: T.ash, fontWeight: 600 }}>655 €/mo</span> − subscription 390 € = <span style={{ color: T.moss, fontWeight: 700 }}>net +265 €/mo</span> from month one.
                </div>
              )}
            </div>
          </Card>
        );
      })}

      <button
        onClick={() => setConfirmed(true)}
        style={{
          width: "100%", padding: "14px 0", borderRadius: 14, border: "none", cursor: "pointer",
          fontSize: 14, fontWeight: 700,
          background: confirmed ? `${T.moss}22` : T.ember,
          color: confirmed ? T.moss : "#18140F",
          transition: "background 0.2s",
        }}>
        {confirmed
          ? `✓ ${current.name} requested — confirmation by email`
          : current.id === "hearth"
            ? "Start Hearth — book engineering visit"
            : current.price === 0 ? "Stay on Insight" : `Subscribe to ${current.name}`}
      </button>

      <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.5, padding: "0 4px" }}>
        Prices ex-VAT, billed on your electricity invoice. Hearth pricing is site-specific and confirmed after the engineering survey. Savings floor applies per contract terms. Mockup.
      </div>
    </div>
  );
}

/* ───────────── SITE ASSESSMENT ───────────── */
function Assessment({ onBack, onPlans }) {
  const total = savingsStack.reduce((s, x) => s + x.val, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* back + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} style={{
          width: 32, height: 32, borderRadius: 10, border: `1px solid ${T.line}`,
          background: T.card, color: T.ash, cursor: "pointer", fontSize: 15, lineHeight: 1,
        }}>‹</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ash }}>Site assessment</div>
          <div style={{ fontSize: 11, color: T.dim }}>Cold storage — Gostivar · based on your last 12 months of meter data</div>
        </div>
      </div>

      {/* headline savings */}
      <Card style={{ background: `linear-gradient(150deg, ${T.ember}2A, ${T.card})`, textAlign: "center", padding: "22px 16px" }}>
        <Eyebrow color={T.ember}>Estimated saving with hosted solar + battery</Eyebrow>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: 42, fontWeight: 700,
          color: T.ash, lineHeight: 1, letterSpacing: "-0.02em",
        }}>
          {total} €<span style={{ fontSize: 17, color: T.dim, fontWeight: 500 }}> /month</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: T.dim }}>
          ≈ {(total * 12).toLocaleString()} €/year · 14% off this site's bill · zero capex
        </div>
      </Card>

      {/* before/after load profile */}
      <Card>
        <Eyebrow>Grid draw · typical day · kW</Eyebrow>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={assessProfile} margin={{ top: 6, right: 0, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="beforeG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.dim} stopOpacity={0.35} />
                <stop offset="100%" stopColor={T.dim} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="afterG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.ember} stopOpacity={0.55} />
                <stop offset="100%" stopColor={T.ember} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="h" tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div style={{
                  background: T.bg, border: `1px solid ${T.line}`, borderRadius: 10,
                  padding: "6px 10px", fontSize: 12, color: T.ash,
                }}>
                  <div style={{ color: T.dim }}>{label}:00</div>
                  <div>Today: {payload.find(p => p.dataKey === "before")?.value} kW</div>
                  <div style={{ color: T.ember }}>With system: {payload.find(p => p.dataKey === "after")?.value} kW</div>
                </div>
              );
            }} />
            <Area type="monotone" dataKey="before" stroke={T.dim} strokeWidth={1.5} strokeDasharray="4 3" fill="url(#beforeG)" />
            <Area type="monotone" dataKey="after" stroke={T.ember} strokeWidth={2} fill="url(#afterG)" />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 10, color: T.dim }}>
          <span><span style={{ color: T.dim }}>– –</span> Grid draw today</span>
          <span><span style={{ color: T.ember }}>—</span> With solar + battery</span>
        </div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 8, lineHeight: 1.5 }}>
          The 14:00 defrost spike (26 kW) is clipped by battery discharge; midday load runs on rooftop solar; the battery recharges from solar surplus and discharges into the 18–21h price peak.
        </div>
      </Card>

      {/* proposed system */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px 8px" }}><Eyebrow>Proposed system</Eyebrow></div>
        {[
          ["Rooftop solar", "40 kWp · ~52 MWh/yr"],
          ["Battery", "30 kW / 60 kWh LFP"],
          ["New peak demand", "max 18 kW (was 26 kW)"],
          ["Contracted demand", "can drop 80 → 60 kW"],
        ].map(([k, v], i, arr) => (
          <div key={k} style={{
            display: "flex", justifyContent: "space-between", padding: "11px 16px",
            borderTop: i > 0 ? `1px solid ${T.line}` : "none", fontSize: 13,
          }}>
            <span style={{ color: T.dim }}>{k}</span>
            <span style={{ color: T.ash, fontWeight: 600, textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </Card>

      {/* savings stack */}
      <Card>
        <Eyebrow>Where the saving comes from · €/month</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
          {savingsStack.map((s) => (
            <div key={s.name}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                <span style={{ color: T.ash }}>{s.name}</span>
                <span style={{ color: T.amber, fontWeight: 700 }}>{s.val} €</span>
              </div>
              <div style={{ height: 6, background: T.line, borderRadius: 3 }}>
                <div style={{
                  height: "100%", width: `${(s.val / 110) * 100}%`,
                  background: `linear-gradient(90deg, ${T.amber}, ${T.ember})`, borderRadius: 3,
                }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* terms */}
      <Card style={{ background: `linear-gradient(135deg, ${T.mossDark}33, ${T.card})` }}>
        <Eyebrow color={T.moss}>How the deal works</Eyebrow>
        <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.6 }}>
          Vatra finances, builds, owns, and operates the system on your roof. You buy its output at a fixed price below grid, under a 10-year supply contract. Maintenance, insurance, and monitoring are on us. At year 10, buy it out at residual value or extend.
        </div>
      </Card>

      <button
        onClick={onPlans}
        style={{
          width: "100%", padding: "14px 0", borderRadius: 14, border: "none", cursor: "pointer",
          fontSize: 14, fontWeight: 700, background: T.ember, color: "#18140F",
        }}>
        Continue — choose your plan
      </button>

      <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.5, padding: "0 4px" }}>
        Indicative figures from meter data and current tariffs. Final sizing and pricing follow the on-site engineering survey. Mockup.
      </div>
    </div>
  );
}

/* ───────────── PAY ───────────── */
const txHome = [
  { name: "Skopje City Mall · groceries", amt: -24.6, back: "+3.1 kWh back", d: "Today" },
  { name: "Tinex Gostivar", amt: -12.3, back: "+1.5 kWh back", d: "Tue" },
  { name: "Gift from Aleksandar · Munich", amt: +50.0, back: null, d: "Mon" },
  { name: "Solar yield → balance", amt: +7.2, back: null, d: "1 Jun" },
];
const merchants = [
  { name: "Skopje City Mall", perk: "1.5% back in kWh" },
  { name: "Tinex markets", perk: "1% back in kWh" },
  { name: "Makpetrol stations", perk: "EV charging −10%" },
  { name: "East Gate Mall", perk: "2% back in kWh, weekends" },
];
const merchantRx = [
  { name: "Vatra Balance accepted", amt: 1240.0, d: "June so far" },
  { name: "Card equivalent fees avoided", amt: 11.2, d: "vs 1.8% scheme" },
];

function FauxQR({ seed = 7 }) {
  const n = 13, cells = [];
  let s = seed;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const corner = (x < 4 && y < 4) || (x > n - 5 && y < 4) || (x < 4 && y > n - 5);
    if (corner || s % 5 < 2) cells.push([x, y]);
  }
  return (
    <svg width="148" height="148" viewBox={`0 0 ${n} ${n}`} style={{ borderRadius: 10, background: T.ash, padding: 0 }}>
      {cells.map(([x, y], i) => (
        <rect key={i} x={x + 0.08} y={y + 0.08} width="0.84" height="0.84" fill="#18140F" rx="0.15" />
      ))}
    </svg>
  );
}

function PayHousehold() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* balance */}
      <Card style={{ background: `linear-gradient(150deg, ${T.ember}22, ${T.card})`, textAlign: "center", padding: "20px 16px" }}>
        <Eyebrow color={T.ember}>Vatra Balance</Eyebrow>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: 40, fontWeight: 700,
          color: T.ash, lineHeight: 1, letterSpacing: "-0.02em",
        }}>
          86.40 €
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: T.dim }}>
          ≈ <span style={{ color: T.amber, fontWeight: 700 }}>823 kWh</span> at your pack rate · always spendable on electricity
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {["Top up", "Send", "Gift a pack"].map((a) => (
            <button key={a} style={{
              flex: 1, padding: "9px 0", borderRadius: 11, fontSize: 12, fontWeight: 700,
              border: `1px solid ${T.line}`, background: T.card, color: T.ash, cursor: "pointer",
            }}>{a}</button>
          ))}
        </div>
      </Card>

      {/* QR */}
      <Card style={{ textAlign: "center", padding: "20px 16px" }}>
        <Eyebrow>Pay in store · show at checkout</Eyebrow>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
          <FauxQR />
        </div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 10 }}>
          Code refreshes every 60 s · purchases earn cashback in kWh
        </div>
      </Card>

      {/* activity */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px 8px" }}><Eyebrow>Activity</Eyebrow></div>
        {txHome.map((t, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "11px 16px", borderTop: i > 0 ? `1px solid ${T.line}` : "none",
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ash }}>{t.name}</div>
              <div style={{ fontSize: 11, color: T.dim, marginTop: 1 }}>
                {t.d}{t.back && <span style={{ color: T.moss, fontWeight: 600 }}> · {t.back}</span>}
              </div>
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
              color: t.amt > 0 ? T.moss : T.ash,
            }}>
              {t.amt > 0 ? "+" : ""}{t.amt.toFixed(2)} €
            </div>
          </div>
        ))}
      </Card>

      {/* merchants */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px 8px" }}><Eyebrow>Where Vatra pays</Eyebrow></div>
        {merchants.map((m, i) => (
          <div key={m.name} style={{
            display: "flex", justifyContent: "space-between", padding: "11px 16px",
            borderTop: i > 0 ? `1px solid ${T.line}` : "none", fontSize: 13,
          }}>
            <span style={{ color: T.ash, fontWeight: 600 }}>{m.name}</span>
            <span style={{ color: T.amber, fontSize: 12 }}>{m.perk}</span>
          </div>
        ))}
      </Card>

      <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.5, padding: "0 4px" }}>
        Closed-loop balance, spendable on Vatra electricity and at partner merchants. Not a bank account; no cash withdrawal. Mockup.
      </div>
    </div>
  );
}

function PayBusiness() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ background: `linear-gradient(150deg, ${T.mossDark}44, ${T.card})` }}>
        <Eyebrow color={T.moss}>Accepting Vatra Balance</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, fontWeight: 700, color: T.ash,
          }}>1,240 €</span>
          <span style={{ fontSize: 13, color: T.moss, fontWeight: 600 }}>received in June</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: T.dim, lineHeight: 1.55 }}>
          Settles as a deduction on your <span style={{ color: T.ash, fontWeight: 600 }}>July electricity invoice</span> — no card scheme, no payout delay. Acceptance fee 0.9% vs ~1.8% on cards.
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card>
          <Eyebrow>Net to invoice</Eyebrow>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.moss, fontFamily: "'Space Grotesk', sans-serif" }}>−1,228.84 €</div>
          <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>off est. 612 € → credit carries</div>
        </Card>
        <Card>
          <Eyebrow>Fees saved YTD</Eyebrow>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.ash, fontFamily: "'Space Grotesk', sans-serif" }}>64 €</div>
          <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>vs card acquiring</div>
        </Card>
      </div>

      <Card style={{ textAlign: "center", padding: "20px 16px" }}>
        <Eyebrow>Your acceptance code · till #1</Eyebrow>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
          <FauxQR seed={23} />
        </div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 10 }}>
          Customers scan to pay · funds net against your power bill
        </div>
      </Card>

      <Card style={{ background: `linear-gradient(135deg, ${T.ember}1F, ${T.card})` }}>
        <div style={{ fontSize: 13, color: T.ash, fontWeight: 600 }}>Run a kWh-back promotion</div>
        <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>
          Fund 2% cashback in kWh for weekend shoppers — costs you energy at your pack rate, reads as a 2% discount to them.
        </div>
      </Card>

      <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.5, padding: "0 4px" }}>
        Closed-loop settlement netted against electricity invoices under your supply contract. Mockup.
      </div>
    </div>
  );
}

/* ───────────── ACCOUNT ───────────── */
function Account({ biz, onPlans, onPacks }) {
  const rows = biz
    ? [
        ["Electricity pack", "Pack 10 · 10,000 kWh · 780 €/mo"],
        ["Service plan", "Optimize · 3 sites · 147 €/mo"],
        ["Tariff", "Vatra Pro · day-ahead indexed overage"],
        ["Company", "Serafimoski Tech DOOEL"],
        ["Meter points", "3 active sites"],
        ["Contracted demand", "80 kW aggregate"],
        ["Next invoice", "1 July 2026 · est. 612.40 €"],
        ["Green supply", "64% renewable mix"],
        ["Reports", "Monthly ESG / CO₂ export"],
      ]
    : [
        ["Electricity pack", "Pack M · 350 kWh · 31 €/mo"],
        ["Meter point", "MK-31-002-114-882"],
        ["Next invoice", "1 July 2026 · 31.00 € flat"],
        ["Payment", "Auto-pay · **** 4417"],
        ["Green supply", "64% renewable mix"],
      ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{
          width: 48, height: 48, borderRadius: biz ? 14 : "50%", flexShrink: 0,
          background: `linear-gradient(135deg, ${T.ember}, ${T.amber})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, color: "#18140F",
        }}>{biz ? "ST" : "ZS"}</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ash }}>
            {biz ? "Serafimoski Tech" : "Z. Serafimoski"}
          </div>
          <div style={{ fontSize: 12, color: T.dim }}>
            {biz ? "Business · 3 sites" : "Household · Vrapčište"}
          </div>
        </div>
      </Card>
      <Card style={{ padding: 0 }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{
            display: "flex", justifyContent: "space-between", padding: "13px 16px",
            borderBottom: i < rows.length - 1 ? `1px solid ${T.line}` : "none", fontSize: 13,
          }}>
            <span style={{ color: T.dim }}>{k}</span>
            <span style={{ color: T.ash, fontWeight: 500, textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </Card>
      {biz ? (
        <Card style={{ textAlign: "center", padding: 13, display: "flex", justifyContent: "center", gap: 24 }}>
          <span onClick={onPacks} style={{ fontSize: 13, color: T.amber, fontWeight: 600, cursor: "pointer" }}>
            Change pack
          </span>
          <span onClick={onPlans} style={{ fontSize: 13, color: T.amber, fontWeight: 600, cursor: "pointer" }}>
            Service plans
          </span>
        </Card>
      ) : (
        <Card style={{ textAlign: "center", padding: 13, cursor: "pointer" }}>
          <span onClick={onPacks} style={{ fontSize: 13, color: T.amber, fontWeight: 600 }}>
            Change pack
          </span>
        </Card>
      )}
    </div>
  );
}

/* ───────────── shell ───────────── */
export default function Vatra() {
  const [tab, setTab] = useState("home");
  const [persona, setPersona] = useState("home"); // 'home' | 'biz'
  const [screen, setScreen] = useState(null);     // null | 'assess' | 'plans'
  const biz = persona === "biz";

  const tabs = [
    { id: "home", label: biz ? "Sites" : "Hearth", icon: ic.flame, view: biz ? <HomeBusiness /> : <HomeHousehold onPacks={() => setScreen("packs")} /> },
    { id: "usage", label: "Usage", icon: ic.chart, view: <Usage biz={biz} /> },
    { id: "invest", label: "Invest", icon: ic.leaf, view: <Invest biz={biz} onAssess={() => setScreen("assess")} /> },
    { id: "pay", label: "Pay", icon: ic.qr, view: biz ? <PayBusiness /> : <PayHousehold /> },
    { id: "account", label: "Account", icon: ic.user, view: <Account biz={biz} onPlans={() => setScreen("plans")} onPacks={() => setScreen("packs")} /> },
  ];
  const active = tabs.find((t) => t.id === tab);
  const sub = screen === "packs" ? "packs" : (biz ? screen : null);

  return (
    <div style={{
      minHeight: "100vh", background: "#0C0A07", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 0; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>

      <div style={{
        width: 390, height: 800, maxHeight: "94vh", background: T.bg,
        borderRadius: 40, border: "1px solid #3A3128",
        boxShadow: `0 40px 90px rgba(0,0,0,0.6), 0 0 0 8px #1F1A13`,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* header */}
        <div style={{ padding: "22px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20,
            color: T.ash, letterSpacing: "0.01em",
          }}>
            vatra<span style={{ color: T.ember }}>.</span>
          </div>

          {/* persona switch */}
          <div style={{
            display: "flex", background: T.card, border: `1px solid ${T.line}`,
            borderRadius: 99, padding: 3,
          }}>
            {[["home", "Home"], ["biz", "Business"]].map(([id, label]) => (
              <button key={id} onClick={() => { setPersona(id); setScreen(null); }} style={{
                padding: "5px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 700,
                background: persona === id ? T.ember : "transparent",
                color: persona === id ? "#18140F" : T.dim,
                transition: "background 0.2s",
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 18px" }}>
          {sub === "assess"
            ? <Assessment onBack={() => setScreen(null)} onPlans={() => setScreen("plans")} />
            : sub === "plans"
              ? <Plans onBack={() => setScreen(null)} />
              : sub === "packs"
                ? <Packs biz={biz} onBack={() => setScreen(null)} />
                : active.view}
        </div>

        {/* tab bar */}
        <div style={{
          display: "flex", borderTop: `1px solid ${T.line}`,
          background: "#1C1711", padding: "8px 8px 14px",
        }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setScreen(null); }} style={{
              flex: 1, background: "none", border: "none", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 0",
            }}>
              {t.icon(tab === t.id ? T.ember : T.dim)}
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: tab === t.id ? T.ember : T.dim,
              }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
