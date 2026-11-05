import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You are SafeRoute Assistant, a calm, respectful, non-judgmental information and safety-planning assistant.
Your limits:
- You are not an emergency dispatcher, police officer, lawyer, doctor, therapist, or a substitute for a trusted human.
- If the user appears to be in immediate danger, tell them to move toward a populated/ staffed place if possible and call the appropriate local emergency service. For India, 112 is the nationwide emergency number; 181 is the Women Helpline. Do not imply that this chat sends an emergency alert.
- Do not promise confidentiality. The user has been told that this AI conversation is processed by an external AI provider and may be reviewed by authorised SafeRoute admins.
- Encourage users not to share passwords, identity numbers, precise home addresses, or unnecessary identifying information.
- Offer practical, non-judgmental options. Do not blame the person experiencing harassment or abuse.
- Do not invent local phone numbers, laws, services, or guaranteed outcomes. Ask for the country/state only when needed, and recommend checking official sources.
- If a user describes domestic abuse or stalking, avoid advice that could increase risk (such as confronting an abuser). Suggest safer device use and trusted local support.
- Be concise, empathetic, and clear. Respond in the user's language where possible.`;

type HistoryItem = { role: 'user' | 'assistant'; content: string };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Sign-in required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase function environment is incomplete.');
    const authClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const message = String(body?.message ?? '').trim();
    const history = Array.isArray(body?.history) ? body.history.slice(-8) as HistoryItem[] : [];
    if (!message || message.length > 3000) return new Response(JSON.stringify({ error: 'Message must contain 1–3000 characters.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const provider = (Deno.env.get('AI_PROVIDER') || 'gemini').toLowerCase();
    let reply = '';

    if (provider === 'openrouter') {
      const apiKey = Deno.env.get('OPENROUTER_API_KEY');
      if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
      const model = Deno.env.get('OPENROUTER_MODEL') || 'openrouter/free';
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
          .map((item) => ({ role: item.role, content: item.content.slice(0, 3000) })),
      ];
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://saferoute.example', 'X-Title': 'SafeRoute Hackathon Prototype' },
        body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 700 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || `OpenRouter returned ${response.status}`);
      reply = String(result?.choices?.[0]?.message?.content || '').trim();
    } else {
      const apiKey = Deno.env.get('GEMINI_API_KEY');
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
      const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
      const contents = history
        .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
        .map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content.slice(0, 3000) }] }));
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: contents.length ? contents : [{ role: 'user', parts: [{ text: message }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || `Gemini returned ${response.status}`);
      reply = (result?.candidates?.[0]?.content?.parts || []).map((part: { text?: string }) => part.text || '').join('').trim();
    }

    if (!reply) reply = 'I could not prepare a response just now. Please try again, or contact a trusted person or local support service.';
    return new Response(JSON.stringify({ reply }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected AI service error';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
