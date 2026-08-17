import { authenticate, handler, json } from "../_shared/auth.ts";

const PAGE = 500;

type Kind = "invoice" | "reminder" | "dunning";
type Lang = "mk" | "sq" | "en";

const MONEY = (n: number, cur: string) =>
  `${Number(n ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

const TEXTS: Record<Lang, Record<Kind, (p: { no: string; amount: string; due: string; days: number; level: number }) => { title: string; body: string }>> = {
  mk: {
    invoice: (p) => ({
      title: `Нова фактура ${p.no}`,
      body: `Вашата фактура ${p.no} на износ ${p.amount} е издадена. Рок на плаќање: ${p.due}. Фактурата можете да ја преземете во делот „Фактури“.`,
    }),
    reminder: (p) => ({
      title: `Потсетување за плаќање — ${p.no}`,
      body: `Ве потсетуваме дека фактурата ${p.no} на износ ${p.amount} со рок ${p.due} сè уште не е евидентирана како платена. Ако веќе сте платиле, ве молиме занемарете го ова известување.`,
    }),
    dunning: (p) => ({
      title: `Опомена пред достасување (${p.level}. степен) — ${p.no}`,
      body: `Фактурата ${p.no} на износ ${p.amount} е доспеана на ${p.due} и е неплатена ${p.days} дена. Ве молиме да го измирите долгот во рок од 8 дена. Во спротивно ќе се пресметува законска затезна камата и постапката ќе биде препратена на наплата, со можност за прекин на снабдувањето согласно условите од договорот.`,
    }),
  },
  sq: {
    invoice: (p) => ({
      title: `Faturë e re ${p.no}`,
      body: `Fatura juaj ${p.no} në shumën ${p.amount} është lëshuar. Afati i pagesës: ${p.due}. Faturën mund ta shkarkoni te seksioni “Faturat”.`,
    }),
    reminder: (p) => ({
      title: `Kujtesë për pagesë — ${p.no}`,
      body: `Ju kujtojmë se fatura ${p.no} në shumën ${p.amount} me afat ${p.due} ende nuk figuron e paguar. Nëse e keni paguar, ju lutemi shpërfilleni këtë njoftim.`,
    }),
    dunning: (p) => ({
      title: `Vërejtje (shkalla ${p.level}) — ${p.no}`,
      body: `Fatura ${p.no} në shumën ${p.amount} ka skaduar më ${p.due} dhe është e papaguar prej ${p.days} ditësh. Ju lutemi ta shlyeni brenda 8 ditësh, përndryshe llogaritet kamatë ligjore dhe procedura kalon në arkëtim, me mundësi ndërprerjeje të furnizimit sipas kushteve të kontratës.`,
    }),
  },
  en: {
    invoice: (p) => ({
      title: `New invoice ${p.no}`,
      body: `Your invoice ${p.no} for ${p.amount} has been issued. Due date: ${p.due}. You can download it from the Invoices section.`,
    }),
    reminder: (p) => ({
      title: `Payment reminder — ${p.no}`,
      body: `This is a reminder that invoice ${p.no} for ${p.amount}, due ${p.due}, is still unpaid. Please ignore this notice if payment has already been made.`,
    }),
    dunning: (p) => ({
      title: `Formal notice (level ${p.level}) — ${p.no}`,
      body: `Invoice ${p.no} for ${p.amount} was due on ${p.due} and is ${p.days} days overdue. Please settle within 8 days; otherwise statutory late interest applies and the debt is passed to collection, with possible suspension of supply under the contract terms.`,
    }),
  },
};

function langFor(country?: string | null, override?: string): Lang {
  if (override && override !== "auto") return override as Lang;
  if (country === "MK") return "mk";
  if (country === "AL" || country === "XK") return "sq";
  return "en";
}

// Automated runs (pg_cron / server-side schedulers) present the service-role
// key; interactive runs present a staff JWT that must carry a billing role.
// _shared/auth.ts distinguishes the two — the previous auth.getUser() path
// 401'd on every scheduled run because a service-role JWT has no `sub`.
Deno.serve(handler(async (req) => {
  const auth = await authenticate(req, {
    roles: ["admin", "management", "billing_officer", "finance"],
  });
  const admin = auth.admin;
  const uid = auth.userId;

  try {
    const payload = await req.json().catch(() => ({}));
    const kind: Kind = ["invoice", "reminder", "dunning"].includes(payload?.kind) ? payload.kind : "invoice";
    const langOverride: string = typeof payload?.language === "string" ? payload.language : "auto";
    const invoiceIds: string[] | null = Array.isArray(payload?.invoice_ids) && payload.invoice_ids.length
      ? payload.invoice_ids.filter((v: unknown) => typeof v === "string")
      : null;
    // Operator-chosen sender (must be on the verified domain — validated again
    // inside send-transactional-email) and optional recipient override for
    // one-off sends to a different address than the client contact.
    const fromEmail: string | null = typeof payload?.from_email === "string" && payload.from_email.includes("@")
      ? payload.from_email.trim() : null;
    const recipientOverride: string | null = typeof payload?.recipient_email === "string" && payload.recipient_email.includes("@")
      ? payload.recipient_email.trim() : null;

    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);

    // Paginated fetch — a large dunning run easily exceeds PostgREST's
    // default row cap, which would silently drop invoices from the batch.
    type Inv = Record<string, any>;
    const invoices: Inv[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = admin
        .from("invoices")
        .select("id, invoice_number, client_id, total_eur, paid_amount_eur, currency, due_date, period_end, status, sent_at, sent_count, dunning_level, reminder_count")
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);

      if (invoiceIds) {
        q = q.in("id", invoiceIds);
      } else if (kind === "invoice") {
        // Auto-send: every invoice that has never been delivered to the customer.
        q = q.is("sent_at", null).neq("status", "draft");
      } else {
        // Reminders / dunning target unpaid invoices past their due date.
        q = q.neq("status", "paid").not("due_date", "is", null).lt("due_date", todayISO);
      }

      const { data: page, error: invErr } = await q;
      if (invErr) return json({ error: invErr.message }, 500);
      invoices.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }
    if (!invoices.length) return json({ processed: 0, skipped: 0, results: [] });

    const clientIds = [...new Set(invoices.map((i) => i.client_id))];
    const clientById = new Map<string, Record<string, any>>();
    for (let i = 0; i < clientIds.length; i += PAGE) {
      const chunk = clientIds.slice(i, i + PAGE);
      const { data: clients, error: cErr } = await admin
        .from("clients")
        .select("id, company_name, contact_email, country_code, portal_user_id")
        .in("id", chunk)
        .range(0, chunk.length - 1);
      if (cErr) return json({ error: cErr.message }, 500);
      for (const c of clients ?? []) clientById.set(c.id, c);
    }

    let processed = 0;
    let skipped = 0;
    const results: Array<{ invoice: string; status: string; detail?: string }> = [];

    for (const inv of invoices) {
      const client = clientById.get(inv.client_id);
      if (!client) { skipped++; results.push({ invoice: inv.invoice_number, status: "skipped", detail: "client missing" }); continue; }

      const outstanding = Number(inv.total_eur ?? 0) - Number(inv.paid_amount_eur ?? 0);
      if (kind !== "invoice" && outstanding <= 0.009) {
        skipped++; results.push({ invoice: inv.invoice_number, status: "skipped", detail: "already paid" });
        continue;
      }

      // Drafts have no allocated invoice_number yet (numbers are issued by
      // issue_billing_run). Sending one would deliver a notice with a blank
      // number and the follow-up status update would violate the
      // invoices_number_when_issued constraint, so refuse up front.
      if (inv.status === "draft" || !inv.invoice_number) {
        skipped++;
        results.push({
          invoice: inv.invoice_number ?? inv.id,
          status: "skipped",
          detail: "Invoice is still a draft — issue the billing run first to allocate an invoice number.",
        });
        continue;
      }

      const lang = langFor(client.country_code, langOverride);
      const dueDate = inv.due_date ?? inv.period_end;
      const days = dueDate ? Math.max(0, Math.floor((today.getTime() - new Date(dueDate).getTime()) / 86400000)) : 0;
      const level = kind === "dunning" ? Number(inv.dunning_level ?? 0) + 1 : 0;
      const amount = MONEY(kind === "invoice" ? Number(inv.total_eur ?? 0) : outstanding, inv.currency ?? "EUR");
      const text = TEXTS[lang][kind]({
        no: inv.invoice_number,
        amount,
        due: dueDate ? new Date(dueDate).toLocaleDateString("mk-MK") : "—",
        days,
        level,
      });

      let channel = "portal";
      let status = "sent";
      let error: string | null = null;
      let emailed = false;

      if (client.portal_user_id) {
        const { error: nErr } = await admin.from("notifications").insert({
          user_id: client.portal_user_id,
          topic: "billing",
          title: text.title,
          body: text.body,
          url: "/portal/invoices",
          data: { invoice_id: inv.id, invoice_number: inv.invoice_number, kind, dunning_level: level },
          delivered: true,
        });
        if (nErr) { status = "failed"; error = nErr.message; }
      } else {
        channel = "none";
        status = "failed";
        error = "Клиентот нема активна порталска сметка (нема на кого да се достави).";
      }

      // Email delivery — the invoice notice also goes to the client's billing
      // address, so customers without a portal login still get the document.
      const mailTo = recipientOverride ?? client.contact_email;
      if (mailTo) {
        const { data: mailRes, error: mailErr } = await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "invoice-notice",
            recipientEmail: mailTo,
            ...(fromEmail ? { fromEmail, replyTo: fromEmail } : {}),
            idempotencyKey: `inv-${kind}-${inv.id}-${mailTo}-${kind === "invoice" ? "1" : new Date().toISOString().slice(0, 10)}`,
            templateData: {
              kind,
              lang,
              companyName: client.company_name,
              invoiceNumber: inv.invoice_number,
              amount,
              dueDate: dueDate ? new Date(dueDate).toLocaleDateString("mk-MK") : "—",
              daysOverdue: days,
              dunningLevel: level || 1,
              portalUrl: "https://volttrade.app/portal/invoices",
            },
          },
        });
        if (mailErr) {
          console.error("invoice email failed", inv.invoice_number, mailErr);
        } else if ((mailRes as { success?: boolean } | null)?.success) {
          emailed = true;
        }
        if (emailed) {
          channel = channel === "portal" ? "portal+email" : "email";
          status = "sent";
          error = null;
        }
      }

      await admin.from("invoice_dispatches").insert({
        invoice_id: inv.id,
        client_id: client.id,
        kind,
        dunning_level: level,
        channel,
        language: lang,
        recipient: mailTo ?? null,
        status,
        error,
        created_by: uid,
      });

      if (status === "sent") {
        const nowISO = new Date().toISOString();
        const patch: Record<string, unknown> = { notice_language: lang };
        if (kind === "invoice") {
          patch.sent_at = inv.sent_at ?? nowISO;
          patch.sent_count = 1 + Number((inv as { sent_count?: number }).sent_count ?? 0);
        } else if (kind === "reminder") {
          patch.last_reminder_at = nowISO;
          patch.reminder_count = Number(inv.reminder_count ?? 0) + 1;
        } else {
          patch.last_dunning_at = nowISO;
          patch.dunning_level = level;
        }
        const { error: updErr } = await admin.from("invoices").update(patch).eq("id", inv.id);
        if (updErr) {
          console.error("invoice send bookkeeping failed", inv.invoice_number, updErr);
          skipped++;
          results.push({ invoice: inv.invoice_number, status: "failed", detail: `delivered but not recorded: ${updErr.message}` });
          continue;
        }
        processed++;
        results.push({ invoice: inv.invoice_number, status: "sent" });
      } else {
        skipped++;
        results.push({ invoice: inv.invoice_number, status: "failed", detail: error ?? undefined });
      }
    }

    return json({ processed, skipped, results });
  } catch (e) {
    console.error("send-invoice-notices failed:", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
}));