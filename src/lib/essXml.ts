// ENTSO-E ESS v4 Scheduling Document generator (MAVIR / MEPSO / generic EU TSO compatible)
// Output is a single XML string the user can download and submit.

const AREA_EIC: Record<string, string> = {
  MAVIR: "10YHU-MAVIR----U",
  HU: "10YHU-MAVIR----U",
  MEPSO: "10YMK-MEPSO----8",
  MK: "10YMK-MEPSO----8",
  APG: "10YAT-APG------L",
  AT: "10YAT-APG------L",
  TENNET: "10YDE-EON------1",
  "50HZ": "10YDE-VE-------2",
  TRANSELECTRICA: "10YRO-TEL------P",
  RO: "10YRO-TEL------P",
  EMS: "10YCS-SERBIATSOV",
  RS: "10YCS-SERBIATSOV",
};

function resolveEic(tsoArea: string): string {
  const key = tsoArea?.trim().toUpperCase();
  return AREA_EIC[key] ?? key ?? "10YHU-MAVIR----U";
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/[<>&'"]/g, c => ({ "<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;","\"":"&quot;" }[c]!));
}

function ymdHm(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
}

export type EssSchedule = {
  schedule_number: string;
  tso_area: string;
  delivery_date: string; // yyyy-MM-dd
  version: number;
  sender_eic?: string;
  receiver_eic?: string;
};

export type EssLine = { hour: number; direction: string; volume_mwh: number };

export function buildEssV4Xml(s: EssSchedule, lines: EssLine[]): string {
  const areaEic = resolveEic(s.tso_area);
  const senderEic = s.sender_eic || "10X1001A1001A450"; // placeholder — replace with your party EIC
  const receiverEic = s.receiver_eic || areaEic;
  const dayStart = new Date(`${s.delivery_date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const created = ymdHm(new Date());

  // Aggregate per-hour by direction
  const byDir = new Map<string, number[]>();
  for (const l of lines) {
    const arr = byDir.get(l.direction) ?? Array(24).fill(0);
    arr[l.hour] = (arr[l.hour] ?? 0) + Number(l.volume_mwh || 0);
    byDir.set(l.direction, arr);
  }

  let tsBlocks = "";
  let tsIdx = 1;
  for (const [direction, hourly] of byDir.entries()) {
    const flow = direction === "out" ? "A02" : "A01"; // A01=in, A02=out (simplified)
    const points = hourly.map((v, i) =>
      `        <Point><position>${i + 1}</position><quantity>${Number(v).toFixed(3)}</quantity></Point>`
    ).join("\n");
    tsBlocks += `
  <TimeSeries>
    <mRID>${tsIdx}</mRID>
    <businessType>A01</businessType>
    <product>8716867000016</product>
    <objectAggregation>A01</objectAggregation>
    <in_Domain.mRID codingScheme="A01">${esc(areaEic)}</in_Domain.mRID>
    <out_Domain.mRID codingScheme="A01">${esc(areaEic)}</out_Domain.mRID>
    <in_MarketParticipant.mRID codingScheme="A01">${esc(senderEic)}</in_MarketParticipant.mRID>
    <out_MarketParticipant.mRID codingScheme="A01">${esc(senderEic)}</out_MarketParticipant.mRID>
    <flowDirection.direction>${flow}</flowDirection.direction>
    <measurement_Unit.name>MAW</measurement_Unit.name>
    <Period>
      <timeInterval>
        <start>${ymdHm(dayStart)}</start>
        <end>${ymdHm(dayEnd)}</end>
      </timeInterval>
      <resolution>PT60M</resolution>
${points}
    </Period>
  </TimeSeries>`;
    tsIdx++;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ScheduleDocument xmlns="urn:entsoe.eu:wgedi:ess:scheduledocument:4:0">
  <DocumentIdentification v="${esc(s.schedule_number)}"/>
  <DocumentVersion v="${s.version}"/>
  <DocumentType v="A01"/>
  <ProcessType v="A01"/>
  <SenderIdentification v="${esc(senderEic)}" codingScheme="A01"/>
  <SenderRole v="A08"/>
  <ReceiverIdentification v="${esc(receiverEic)}" codingScheme="A01"/>
  <ReceiverRole v="A04"/>
  <CreationDateTime v="${created}"/>
  <ScheduleTimeInterval v="${ymdHm(dayStart)}/${ymdHm(dayEnd)}"/>
  <Domain v="${esc(areaEic)}" codingScheme="A01"/>
  <SubjectParty v="${esc(senderEic)}" codingScheme="A01"/>
  <SubjectRole v="A08"/>
${tsBlocks}
</ScheduleDocument>
`;
}

export function downloadXml(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}