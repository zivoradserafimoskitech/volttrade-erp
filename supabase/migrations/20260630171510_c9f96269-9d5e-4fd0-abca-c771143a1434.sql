-- Device tokens
CREATE TABLE public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'web',
  user_agent text,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;
GRANT ALL ON public.device_tokens TO service_role;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tokens" ON public.device_tokens FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_device_tokens_updated BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Notification preferences
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY,
  billing boolean NOT NULL DEFAULT true,
  savings boolean NOT NULL DEFAULT true,
  ev boolean NOT NULL DEFAULT true,
  alerts boolean NOT NULL DEFAULT true,
  outage boolean NOT NULL DEFAULT true,
  cheapest_slot boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prefs" ON public.notification_preferences FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_notif_prefs_updated BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Notification history
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  topic text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  url text,
  data jsonb,
  delivered boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notif read" ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "own notif update" ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);