-- REPAIR 2026-09-01: CREATE POLICY made idempotent. The file dropped the old
-- policy name but not the new one, so on replay it aborted at line 6 with
-- "policy already exists" -- which meant clients_block_portal_sensitive_update()
-- further down was never created, breaking two later migrations that REVOKE on it.

-- 1) balance_groups / balance_schedules / settlements: staff-only SELECT
DROP POLICY IF EXISTS "auth read balance_groups" ON public.balance_groups;
DROP POLICY IF EXISTS "staff read balance_groups" ON public.balance_groups;
CREATE POLICY "staff read balance_groups" ON public.balance_groups
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','operations','trader','supply_manager','billing_officer','finance','risk_officer','auditor']::app_role[]));

DROP POLICY IF EXISTS "auth read balance_schedules" ON public.balance_schedules;
DROP POLICY IF EXISTS "staff read balance_schedules" ON public.balance_schedules;
CREATE POLICY "staff read balance_schedules" ON public.balance_schedules
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','operations','trader','supply_manager','billing_officer','finance','risk_officer','auditor']::app_role[]));

DROP POLICY IF EXISTS "auth read settlements" ON public.settlements;
DROP POLICY IF EXISTS "staff read settlements" ON public.settlements;
CREATE POLICY "staff read settlements" ON public.settlements
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','management','operations','trader','supply_manager','billing_officer','finance','risk_officer','auditor']::app_role[]));

-- 2) clients: prevent portal user from modifying sensitive commercial fields via trigger
CREATE OR REPLACE FUNCTION public.clients_block_portal_sensitive_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only enforce when the update is being performed by the portal user themselves
  -- (i.e. not by staff/service role). Staff updates route via other policies.
  IF NEW.portal_user_id IS NOT NULL AND NEW.portal_user_id = auth.uid()
     AND NOT public.has_any_role(auth.uid(),
       ARRAY['admin','management','operations','supply_manager','billing_officer','finance']::app_role[])
  THEN
    IF NEW.margin_eur_mwh       IS DISTINCT FROM OLD.margin_eur_mwh
    OR NEW.fixed_price_eur_mwh  IS DISTINCT FROM OLD.fixed_price_eur_mwh
    OR NEW.credit_limit_eur     IS DISTINCT FROM OLD.credit_limit_eur
    OR NEW.payment_terms_days   IS DISTINCT FROM OLD.payment_terms_days
    OR NEW.contract_type        IS DISTINCT FROM OLD.contract_type
    OR NEW.customer_category    IS DISTINCT FROM OLD.customer_category
    OR NEW.status               IS DISTINCT FROM OLD.status
    OR NEW.user_id              IS DISTINCT FROM OLD.user_id
    OR NEW.portal_user_id       IS DISTINCT FROM OLD.portal_user_id
    OR NEW.tax_id               IS DISTINCT FROM OLD.tax_id
    THEN
      RAISE EXCEPTION 'Portal users cannot modify pricing, credit, or account status fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_block_portal_sensitive_update ON public.clients;
CREATE TRIGGER clients_block_portal_sensitive_update
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_block_portal_sensitive_update();

-- 3) ev_charge_plans: split portal ALL -> portal SELECT + constrained INSERT + DELETE. No portal UPDATE.
DROP POLICY IF EXISTS "portal owns ev plans" ON public.ev_charge_plans;

DROP POLICY IF EXISTS "ev plans read" ON public.ev_charge_plans;

CREATE POLICY "ev plans read" ON public.ev_charge_plans
  FOR SELECT TO authenticated
  USING (client_id = public.current_portal_client_id()
      OR public.has_any_role(auth.uid(), ARRAY['admin','operations','supply_manager','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "ev plans portal insert (no cost)" ON public.ev_charge_plans;

CREATE POLICY "ev plans portal insert (no cost)" ON public.ev_charge_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    (client_id = public.current_portal_client_id()
       AND COALESCE(est_cost_eur, 0) = 0
       AND COALESCE(est_kwh, 0) = 0
       AND avg_price_eur_mwh IS NULL)
    OR public.has_any_role(auth.uid(), ARRAY['admin','operations','supply_manager','billing_officer']::app_role[])
  );

DROP POLICY IF EXISTS "ev plans staff update" ON public.ev_charge_plans;

CREATE POLICY "ev plans staff update" ON public.ev_charge_plans
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','supply_manager','billing_officer']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','operations','supply_manager','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "ev plans portal delete own" ON public.ev_charge_plans;

CREATE POLICY "ev plans portal delete own" ON public.ev_charge_plans
  FOR DELETE TO authenticated
  USING (client_id = public.current_portal_client_id()
      OR public.has_any_role(auth.uid(), ARRAY['admin','operations','supply_manager','billing_officer']::app_role[]));

-- 4) referrals: portal may INSERT pending w/ zero credit; SELECT own; no UPDATE/DELETE from portal.
DROP POLICY IF EXISTS "portal owns referrals" ON public.referrals;

DROP POLICY IF EXISTS "referrals read" ON public.referrals;

CREATE POLICY "referrals read" ON public.referrals
  FOR SELECT TO authenticated
  USING (referrer_client_id = public.current_portal_client_id()
      OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "referrals portal insert pending" ON public.referrals;

CREATE POLICY "referrals portal insert pending" ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (
    (referrer_client_id = public.current_portal_client_id()
       AND status = 'pending'
       AND COALESCE(credit_eur, 0) = 0
       AND credited_at IS NULL)
    OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[])
  );

DROP POLICY IF EXISTS "referrals staff manage" ON public.referrals;

CREATE POLICY "referrals staff manage" ON public.referrals
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "referrals staff delete" ON public.referrals;

CREATE POLICY "referrals staff delete" ON public.referrals
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

-- 5) rewards_ledger: portal SELECT only; staff manage.
DROP POLICY IF EXISTS "portal owns rewards" ON public.rewards_ledger;

DROP POLICY IF EXISTS "rewards read" ON public.rewards_ledger;

CREATE POLICY "rewards read" ON public.rewards_ledger
  FOR SELECT TO authenticated
  USING (client_id = public.current_portal_client_id()
      OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "rewards staff insert" ON public.rewards_ledger;

CREATE POLICY "rewards staff insert" ON public.rewards_ledger
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "rewards staff update" ON public.rewards_ledger;

CREATE POLICY "rewards staff update" ON public.rewards_ledger
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "rewards staff delete" ON public.rewards_ledger;

CREATE POLICY "rewards staff delete" ON public.rewards_ledger
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

-- 6) saving_session_signups: portal may opt in/out (status only); staff compute credits.
DROP POLICY IF EXISTS "portal owns signups" ON public.saving_session_signups;

DROP POLICY IF EXISTS "signups read" ON public.saving_session_signups;

CREATE POLICY "signups read" ON public.saving_session_signups
  FOR SELECT TO authenticated
  USING (client_id = public.current_portal_client_id()
      OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "signups portal opt-in" ON public.saving_session_signups;

CREATE POLICY "signups portal opt-in" ON public.saving_session_signups
  FOR INSERT TO authenticated
  WITH CHECK (
    (client_id = public.current_portal_client_id()
       AND baseline_kwh IS NULL
       AND actual_kwh IS NULL
       AND saved_kwh IS NULL
       AND points_awarded IS NULL
       AND COALESCE(credit_eur, 0) = 0)
    OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[])
  );

DROP POLICY IF EXISTS "signups portal opt-out" ON public.saving_session_signups;

CREATE POLICY "signups portal opt-out" ON public.saving_session_signups
  FOR DELETE TO authenticated
  USING (client_id = public.current_portal_client_id()
      OR public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

DROP POLICY IF EXISTS "signups staff update" ON public.saving_session_signups;

CREATE POLICY "signups staff update" ON public.saving_session_signups
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','operations','billing_officer']::app_role[]));

-- 7) Revoke direct EXECUTE on SECURITY DEFINER helpers from signed-in users.
-- RLS policies continue to work because policy expressions run as the table owner.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_portal_client_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_portal_client_id() TO service_role;
