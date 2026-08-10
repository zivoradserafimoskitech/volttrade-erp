
-- Scope owner policies to the authenticated role explicitly
DROP POLICY IF EXISTS "users manage own dispatch" ON public.asset_dispatch_schedules;
CREATE POLICY "users manage own dispatch" ON public.asset_dispatch_schedules
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own telemetry" ON public.asset_telemetry;
CREATE POLICY "users manage own telemetry" ON public.asset_telemetry
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users read own latest" ON public.asset_telemetry_latest;
CREATE POLICY "users read own latest" ON public.asset_telemetry_latest
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own assets" ON public.assets;
CREATE POLICY "users manage own assets" ON public.assets
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own sites" ON public.sites;
CREATE POLICY "users manage own sites" ON public.sites
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own tokens" ON public.device_tokens;
CREATE POLICY "own tokens" ON public.device_tokens
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own prefs" ON public.notification_preferences;
CREATE POLICY "own prefs" ON public.notification_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own notif read" ON public.notifications;
CREATE POLICY "own notif read" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own notif update" ON public.notifications;
CREATE POLICY "own notif update" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reference data: signed-in users only, no anonymous read
DROP POLICY IF EXISTS "slp_curve_points_read_all" ON public.slp_curve_points;
CREATE POLICY "slp_curve_points_read_auth" ON public.slp_curve_points
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "slp_profiles_read_all" ON public.slp_profiles;
CREATE POLICY "slp_profiles_read_auth" ON public.slp_profiles
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.slp_curve_points FROM anon;
REVOKE ALL ON public.slp_profiles FROM anon;
REVOKE ALL ON public.notifications FROM anon;
REVOKE ALL ON public.notification_preferences FROM anon;
REVOKE ALL ON public.device_tokens FROM anon;
REVOKE ALL ON public.assets FROM anon;
REVOKE ALL ON public.sites FROM anon;
REVOKE ALL ON public.asset_telemetry FROM anon;
REVOKE ALL ON public.asset_telemetry_latest FROM anon;
REVOKE ALL ON public.asset_dispatch_schedules FROM anon;

GRANT SELECT ON public.slp_curve_points TO authenticated;
GRANT SELECT ON public.slp_profiles TO authenticated;
