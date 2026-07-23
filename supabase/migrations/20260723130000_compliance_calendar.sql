-- ═══════════════════════════════════════════════════════════════════
-- Regulatory compliance calendar.
-- Recurring obligations from Правила за пазар на електрична енергија
-- (Сл. весник 96/18) and Правила за балансирање, with generated task
-- instances so nothing is missed. Working-day due dates use the existing
-- public_holidays table.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.compliance_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  legal_ref text,                                   -- e.g. 'Правила за пазар, чл. 27(3)'
  recurrence text NOT NULL CHECK (recurrence IN ('daily','monthly')),
  -- due_rule examples:
  --   {"type":"day_of_month","day":15}          → 15th of the month after the period
  --   {"type":"working_day","n":6}              → 6th working day of the month
  --   {"type":"daily_time","time":"14:30"}      → every delivery day at this time
  --   {"type":"day_before","time":"10:00"}      → day before delivery
  due_rule jsonb NOT NULL,
  responsible_role public.app_role,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.compliance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.compliance_obligations(id) ON DELETE CASCADE,
  period_label text NOT NULL,                       -- '2026-07' or '2026-07-23'
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  completed_at timestamptz,
  completed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obligation_id, period_label)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_obligations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_tasks TO authenticated;
GRANT ALL ON public.compliance_obligations TO service_role;
GRANT ALL ON public.compliance_tasks TO service_role;
ALTER TABLE public.compliance_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read obligations" ON public.compliance_obligations FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "admin write obligations" ON public.compliance_obligations FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','management']::public.app_role[]));
CREATE POLICY "staff read tasks" ON public.compliance_tasks FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff write tasks" ON public.compliance_tasks FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE INDEX IF NOT EXISTS idx_compliance_tasks_due ON public.compliance_tasks (due_at) WHERE status = 'pending';

-- ── Seeded obligations (Правила за пазар на електрична енергија) ──
INSERT INTO public.compliance_obligations (code, title, description, legal_ref, recurrence, due_rule, responsible_role) VALUES
  ('BILATERAL_REPORT',
   'Пријава на билатерални договори до ОПЕЕ',
   'Страните ги пријавуваат сите склучени договори и промени во тековниот месец.',
   'Правила за пазар, чл. 27(3)', 'monthly', '{"type":"day_of_month","day":15}', 'trader'),

  ('PHYSICAL_TX_FORM',
   'Образец за физички трансакции до ОПЕЕ',
   'Врз основа на известувањата од ОПЕЕ за потврдените трансакции за претходниот месец.',
   'Правила за пазар, чл. 36(1)', 'monthly', '{"type":"working_day","n":6}', 'trader'),

  ('OPEE_NOTIFICATION',
   'Известување од ОПЕЕ за потврдени трансакции',
   'ОПЕЕ ги доставува информациите за потврдените трансакции по истекот на месецот — проверка дека е примено.',
   'Правила за пазар, чл. 35', 'monthly', '{"type":"working_day","n":3}', 'trader'),

  ('DAILY_SCHEDULE',
   'Доставување физички распоред (TPS) до ОЕПС',
   'Дневна номинација пред gate closure, согласно Правилата за балансирање.',
   'Правила за балансирање', 'daily', '{"type":"daily_time","time":"14:30"}', 'trader'),

  ('PPEE_NOMINATION',
   'Номинација за откуп на ППЕЕ од ОПЕЕ',
   'ППЕЕ = часовен коефициент × номинирана потрошувачка; коефициентот ОПЕЕ го објавува до 10:00 ден однапред.',
   'Правила за пазар, Прилог 1 т.4', 'daily', '{"type":"daily_time","time":"14:00"}', 'trader'),

  ('MONTHLY_SETTLEMENT',
   'Месечно порамнување на дебаланси',
   'Пресметковниот период изнесува еден календарски месец.',
   'Правила за пазар, чл. 3(2)(10)', 'monthly', '{"type":"working_day","n":10}', 'risk_officer')
ON CONFLICT (code) DO NOTHING;
