import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const { edu_code, direction, current_supplier, new_supplier, requested_date, volume_estimate_mwh } = body ?? {};
    if (!edu_code || !direction) {
      return new Response(JSON.stringify({ error: 'edu_code and direction required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const messageId = `SW-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SwitchRequest xmlns="urn:dso:switch:v1">
  <MessageID>${messageId}</MessageID>
  <CreatedAt>${new Date().toISOString()}</CreatedAt>
  <Direction>${direction}</Direction>
  <EduCode>${edu_code}</EduCode>
  <CurrentSupplier>${current_supplier ?? ''}</CurrentSupplier>
  <NewSupplier>${new_supplier ?? ''}</NewSupplier>
  <RequestedDate>${requested_date ?? ''}</RequestedDate>
  <VolumeEstimateMWh>${volume_estimate_mwh ?? 0}</VolumeEstimateMWh>
</SwitchRequest>`;
    return new Response(JSON.stringify({ message_id: messageId, envelope }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});