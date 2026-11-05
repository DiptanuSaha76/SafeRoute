import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ALLOWED_PROFILES = new Set(['foot-walking', 'cycling-regular', 'driving-car']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Sign-in required for walking/bike route requests.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase function environment is incomplete.');
    const authClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const profile = String(body?.profile || 'foot-walking');
    const start = body?.start;
    const end = body?.end;
    if (!ALLOWED_PROFILES.has(profile)) throw new Error('Unsupported travel profile.');
    const validPoint = (point: unknown) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
    if (!validPoint(start) || !validPoint(end)) throw new Error('Start and end must be [longitude, latitude] coordinate pairs.');

    const apiKey = Deno.env.get('ORS_API_KEY');
    if (!apiKey) throw new Error('ORS_API_KEY is not configured in Supabase function secrets.');
    const response = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' },
      body: JSON.stringify({
        coordinates: [start, end],
        alternative_routes: { target_count: 3, weight_factor: 1.4, share_factor: 0.6 },
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || result?.error || `Routing provider returned ${response.status}`);
    const routes = (result?.features || []).slice(0, 3).map((feature: any) => ({
      coordinates: feature?.geometry?.coordinates || [],
      distance: feature?.properties?.summary?.distance || 0,
      duration: feature?.properties?.summary?.duration || 0,
    }));
    if (!routes.length) throw new Error('No route found for these locations.');
    return new Response(JSON.stringify({ routes }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected routing error';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
