CREATE TABLE public.forecasts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  client_id uuid NOT NULL,
  forecast_date date NOT NULL,
  forecast_mwh numeric NOT NULL DEFAULT 0,
  budget_mwh numeric,
  budget_eur numeric,
  method text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id, forecast_date)
);

CREATE INDEX idx_forecasts_client_date ON public.forecasts (client_id, forecast_date);
CREATE INDEX idx_forecasts_user_date ON public.forecasts (user_id, forecast_date);

ALTER TABLE public.forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fc sel" ON public.forecasts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_any_role(auth.uid(), ARRAY['admin'::app_role,'management'::app_role,'trader'::app_role,'supply_manager'::app_role]));

CREATE POLICY "fc ins" ON public.forecasts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "fc upd" ON public.forecasts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "fc del" ON public.forecasts FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_forecasts_updated_at
BEFORE UPDATE ON public.forecasts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();