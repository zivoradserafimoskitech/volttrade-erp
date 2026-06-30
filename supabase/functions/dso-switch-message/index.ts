import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const xmlEscape = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: allowed } = await userClient.rpc('has_any_role', { _user_id: u.user.id, _roles: ['admin', 'operations', 'supply_manager', 'management'] });
    if (!allowed) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { edu_code, direction, current_supplier, new_supplier, requested_date, volume_estimate_mwh } = body ?? {};
    if (!edu_code || !direction) {
      return new Response(JSON.stringify({ error: 'edu_code and direction required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const messageId = `SW-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SwitchRequest xmlns="urn:dso:switch:v1">
  <MessageID>${xmlEscape(messageId)}</MessageID>
  <CreatedAt>${new Date().toISOString()}</CreatedAt>
  <Direction>${xmlEscape(direction)}</Direction>
  <EduCode>${xmlEscape(edu_code)}</EduCode>
  <CurrentSupplier>${xmlEscape(current_supplier)}</CurrentSupplier>
  <NewSupplier>${xmlEscape(new_supplier)}</NewSupplier>
  <RequestedDate>${xmlEscape(requested_date)}</RequestedDate>
  <VolumeEstimateMWh>${Number(volume_estimate_mwh ?? 0)}</VolumeEstimateMWh>
</SwitchRequest>`;
    return new Response(JSON.stringify({ message_id: messageId, envelope }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});