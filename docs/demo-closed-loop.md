# Demo script — the closed loop

Six minutes. The thing worth showing is not the feature list; it is that
**price signal reaches a physical battery and comes back as settled money**.
Most competitors have one half or the other.

Rehearse it once. The whole demo depends on a price spike existing in the data.

---

## Before you start

- A day with a real evening price spike loaded in Market → Prices
- One BESS asset with `gateway_device_id` set and telemetry flowing
- One client with hourly data for the same day
- Two browser windows: ERP and VoltTrade Cloud, side by side

---

## 0:00 — The problem (45s)

Open Balancing → Live position.

> "We commit to a position the day before. We find out what actually happened
> weeks later, when the meter data settles. Everything in between is forecast —
> and imbalance is priced in both directions, so being long costs money too."

Point at the deviation. Don't explain the architecture yet.

## 0:45 — The price signal (45s)

Market → Prices, the chosen day.

> "Day-ahead prices. Cheap overnight, expensive at the evening peak. Every
> supplier sees this. The question is what you can do about it."

## 1:30 — The decision (60s)

Assets → Dispatch.

> "The optimiser charges through the cheap hours and discharges into the peak.
> It knows our position, so it is sizing against our actual imbalance — not
> just arbitraging the spread."

Show a negative setpoint at midday, positive in the evening.

> "Plus and minus here are charge and discharge. Sign errors in this field buy
> at the peak you meant to sell into, so it is pinned by tests."

## 2:30 — Execution (75s) — **the moment that matters**

Trigger the dispatch push. Switch to VoltTrade Cloud → the device.

> "That schedule is now an EMS plan on the plant. Same numbers."

Show the plan on the gateway side.

> "The gateway still owns safety. Peak shaving overrides the plan, every
> setpoint passes a register whitelist and a range check, and everything is
> audited. The ERP proposes; the plant decides whether it is safe."

Then the credential point — it lands well with technical buyers:

> "Two separate API keys. The one our billing system holds physically cannot
> command a battery. Only the dispatch key has that scope, and granting it
> writes its own audit entry."

## 3:45 — Measurement (45s)

Assets → Monitoring. Show SoC and power following the plan.

> "Same platform, measured. Not a second monitoring stack — one pipeline from
> the device."

## 4:30 — Settlement (60s)

Billing → run the period → the invoice.

> "The energy is billed at the indexed price, with the PPEE obligation and MEMO
> fee as separate lines, VAT on each. This is the Macedonian invoice structure,
> not a generic template."

Then the part that survives due diligence:

> "This calculation ran on the server, in exact decimal — never floating point.
> Every input it used is snapshotted with a hash and the engine version, so we
> can re-derive this invoice in three years if a customer disputes it. Invoice
> numbers are gapless per fiscal year and allocated inside the issuing
> transaction. Once issued, the financial content is immutable — corrections
> mean void and re-issue."

## 5:30 — Close (30s)

> "Price signal, optimisation, physical setpoint, measurement, settlement. One
> loop. Most systems in this market do the commercial half or the SCADA half.
> The value is that the battery moves *because* of the price, and the money
> lands *because* the battery moved."

---

## Questions you will get

**"Is this in production?"** — Answer honestly. If it isn't yet, say so and say
when. A pilot with a named customer is a fine answer; a vague one is not, and
technical buyers verify.

**"How do you know the billing is right?"** — This is the strong ground. 90
tests, property tests asserting invoice lines sum to totals across thousands of
generated cases, and mutation testing that proves the suite catches
reintroduced bugs. Offer to show `src/test/billing.test.ts`.

**"What if the ERP sends a bad setpoint?"** — The gateway's interlocks. Show
`executeAndLog`. The ERP cannot bypass the whitelist or the range check.

**"Who else uses it?"** — Do not inflate. One reference customer running for a
quarter is worth more than a list of pilots.

---

## Do not

- Show the code. Show the system doing something.
- Claim the loop is autonomous if a human still presses the button. Say
  "scheduled every 15 minutes" if that is what it is.
- Demo on live customer data.
- Improvise on tax or regulatory questions — "I'll confirm that with our
  accountant" is a better answer than a confident wrong one.
