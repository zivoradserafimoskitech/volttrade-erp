
-- 1) Tariff switch requests
CREATE TABLE public.tariff_switch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  target_tariff_code text NOT NULL,
  target_tariff_name text,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tariff_switch_requests TO authenticated;
GRANT ALL ON public.tariff_switch_requests TO service_role;
ALTER TABLE public.tariff_switch_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal owns switch requests" ON public.tariff_switch_requests
  FOR ALL TO authenticated
  USING (client_id = public.current_portal_client_id() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role,'billing_officer'::app_role]))
  WITH CHECK (client_id = public.current_portal_client_id() OR public.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_tariff_switch_requests_updated BEFORE UPDATE ON public.tariff_switch_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Saving sessions (global events visible to all portal users)
CREATE TABLE public.saving_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  baseline_method text NOT NULL DEFAULT 'last_10_days_same_hour',
  points_per_kwh numeric NOT NULL DEFAULT 4000,
  eur_per_point numeric NOT NULL DEFAULT 0.001,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.saving_sessions TO authenticated;
GRANT ALL ON public.saving_sessions TO service_role;
ALTER TABLE public.saving_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone authenticated reads sessions" ON public.saving_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manages sessions" ON public.saving_sessions
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role,'management'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role,'management'::app_role]));
CREATE TRIGGER trg_saving_sessions_updated BEFORE UPDATE ON public.saving_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Saving session signups (per client)
CREATE TABLE public.saving_session_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.saving_sessions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  baseline_kwh numeric,
  actual_kwh numeric,
  saved_kwh numeric,
  points_awarded integer DEFAULT 0,
  credit_eur numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'opted_in',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saving_session_signups TO authenticated;
GRANT ALL ON public.saving_session_signups TO service_role;
ALTER TABLE public.saving_session_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal owns signups" ON public.saving_session_signups
  FOR ALL TO authenticated
  USING (client_id = public.current_portal_client_id() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role,'billing_officer'::app_role]))
  WITH CHECK (client_id = public.current_portal_client_id() OR public.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_signups_updated BEFORE UPDATE ON public.saving_session_signups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Referrals
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  referred_email text,
  referred_name text,
  status text NOT NULL DEFAULT 'pending',
  credit_eur numeric NOT NULL DEFAULT 50,
  signed_up_at timestamptz,
  credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal owns referrals" ON public.referrals
  FOR ALL TO authenticated
  USING (referrer_client_id = public.current_portal_client_id() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role,'billing_officer'::app_role]))
  WITH CHECK (referrer_client_id = public.current_portal_client_id() OR public.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_referrals_updated BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Rewards ledger
CREATE TABLE public.rewards_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entry_type text NOT NULL,
  amount_eur numeric NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,
  note text,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rewards_ledger TO authenticated;
GRANT ALL ON public.rewards_ledger TO service_role;
ALTER TABLE public.rewards_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal owns rewards" ON public.rewards_ledger
  FOR ALL TO authenticated
  USING (client_id = public.current_portal_client_id() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role,'billing_officer'::app_role]))
  WITH CHECK (client_id = public.current_portal_client_id() OR public.has_role(auth.uid(),'admin'::app_role));

-- 6) EV vehicles
CREATE TABLE public.ev_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  make text,
  model text,
  battery_kwh numeric NOT NULL DEFAULT 60,
  max_charge_kw numeric NOT NULL DEFAULT 7,
  current_soc_pct integer NOT NULL DEFAULT 30,
  target_soc_pct integer NOT NULL DEFAULT 80,
  ready_by_time time NOT NULL DEFAULT '07:00',
  plugged_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ev_vehicles TO authenticated;
GRANT ALL ON public.ev_vehicles TO service_role;
ALTER TABLE public.ev_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal owns ev vehicles" ON public.ev_vehicles
  FOR ALL TO authenticated
  USING (client_id = public.current_portal_client_id() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role]))
  WITH CHECK (client_id = public.current_portal_client_id() OR public.has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_ev_vehicles_updated BEFORE UPDATE ON public.ev_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7) EV charge plans
CREATE TABLE public.ev_charge_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.ev_vehicles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_for_date date NOT NULL,
  schedule jsonb NOT NULL,
  est_kwh numeric NOT NULL DEFAULT 0,
  est_cost_eur numeric NOT NULL DEFAULT 0,
  avg_price_eur_mwh numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ev_charge_plans TO authenticated;
GRANT ALL ON public.ev_charge_plans TO service_role;
ALTER TABLE public.ev_charge_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal owns ev plans" ON public.ev_charge_plans
  FOR ALL TO authenticated
  USING (client_id = public.current_portal_client_id() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'operations'::app_role]))
  WITH CHECK (client_id = public.current_portal_client_id() OR public.has_role(auth.uid(),'admin'::app_role));
