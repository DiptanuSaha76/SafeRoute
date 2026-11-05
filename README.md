# SafeRoute — Women's Safety & Support Ecosystem (Hackathon MVP)

A React + Vite prototype combining:

- Context-aware driving route comparison using OSRM demo routing, plus optional walking routes through OpenRouteService.
- A community-submitted, admin-verified SafeHaven directory.
- Two separate chat modes: disclosed AI support chat (logged for authorised admin review) and browser-side E2EE one-to-one messaging.
- An editable emergency helpline directory with country/state/city scopes.
- Supabase Auth, Postgres, Row Level Security and Edge Functions.

> **Prototype, not an emergency service.** It does not dispatch police, monitor a user's phone continuously, guarantee route safety, verify every listing automatically, or replace official helplines. For India, call 112 for immediate emergencies.

## 1. Requirements

- Node.js 20+ (Node 22 recommended)
- A Supabase project
- A Gemini API key (free developer tier may be available) or OpenRouter API key with a free model

## 2. Install and run

```bash
npm install
cp .env.example .env.local
```

Set the browser-safe Supabase values in `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Then:

```bash
npm run dev
```

Open `http://localhost:5173`.

## 3. Configure Supabase

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/migrations/001_initial_schema.sql`.
4. In **Authentication → Providers → Email**, configure email confirmation as appropriate for your demo.
5. In **Project Settings → API**, copy the project URL and publishable/anon key into `.env.local`.
6. Deploy the AI function after configuring its secret (see section 4): `supabase functions deploy ai-chat`.
7. For walking routes, set the server-side key and deploy: `supabase secrets set ORS_API_KEY=YOUR_ORS_KEY` then `supabase functions deploy route-planner`.
8. Create the first user from the app.
9. Promote that account to admin from SQL Editor (replace `your_handle`):

```sql
update public.profiles set role = 'admin' where handle = 'your_handle';
```

The app deliberately does not allow users to make themselves admins.

## 4. Configure the AI assistant (keep secrets server-side)

The browser calls a Supabase Edge Function. Never put AI API keys in a `VITE_` environment variable or frontend source code.

Install the Supabase CLI, log in, link your project, then set one provider:

### Gemini (default)

```bash
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY GEMINI_MODEL=gemini-2.5-flash
supabase functions deploy ai-chat
```

### OpenRouter free model alternative

```bash
supabase secrets set AI_PROVIDER=openrouter OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY OPENROUTER_MODEL=openrouter/free
supabase functions deploy ai-chat
```

If you change provider, redeploy or update function secrets as appropriate. Free model availability, limits, data policies and rate caps can change; check the provider's current terms. Avoid putting personally identifying or highly sensitive details in AI prompts.

The AI Support Chat requires explicit consent because messages are sent to an external provider and stored in `support_chat_messages`. Admins can review these records. This mode is **not** E2EE.

## 5. E2EE private chat design and limitations

Private Chat is separate from AI Support Chat:

- The browser generates an RSA-OAEP 2048-bit key pair.
- The private key is encrypted locally with a passphrase-derived AES-GCM key (PBKDF2-SHA-256) and stored in IndexedDB.
- Each message is encrypted with AES-GCM. Its one-time content key is wrapped separately to the sender and recipient public keys.
- Supabase stores only ciphertext, IV and wrapped content keys. Row Level Security allows only the two participants to fetch the ciphertext. There is intentionally no admin policy for `private_messages`.
- The recipient must sign up and unlock Private Chat once to register a public key. Enter their `@username` to start a conversation.

**Important limitations:** this is a hackathon implementation, not a security-audited messaging system. Clearing browser data can permanently lose the private key. There is no key recovery, device migration, forward secrecy, group chat, safety-number verification or robust key rotation. The server still sees participant IDs, timestamps and ciphertext sizes. A compromised device or malicious browser extension can expose plaintext. Do not use this prototype for high-risk real-world situations until it has an independent security review and recovery design.

## 6. Map and route data notes

- Map tiles: OpenStreetMap Standard tile service. The app includes attribution. Follow the OSM tile usage policy and use a suitable hosted provider or self-hosting for real traffic.
- Search: public Nominatim endpoint is rate-limited and intended for light use. The helper serialises geocoding calls with a minimum delay. Do not use it for high-volume autocomplete or production-scale search.
- Driving demo route: `router.project-osrm.org` is a community demo endpoint and is not an SLA-backed production service. It is used for driving routes only.
- Walking route: the app can call the included `route-planner` Supabase Edge Function, which proxies OpenRouteService's `foot-walking` profile. Set `ORS_API_KEY` as a Supabase secret and deploy the function. The API key remains server-side.
- The route “nearby support points” number counts verified SafeHaven records within about 700m of the sampled route geometry. It is **not** a crime-risk score or a safety guarantee.
- Public OSM tiles, public Nominatim and public OSRM may change availability or usage limits. For production, use a contracted OSM-based tile/geocoding/routing provider or self-host the services. OpenRouteService currently documents walking, cycling and driving profiles with a free standard plan, but its quotas and conditions can change; check the live plan before relying on it.

## 7. Emergency helpline data

The migration seeds India-wide 112, 181, 1930, 102 and 101 entries using official national references. The interface supports country/state/city records, and admins can add local entries. This is **not a complete global or state-by-state directory**. Before publishing a local number, verify its scope, operating hours, toll-free status and official source with the relevant government department. Add `verified_at` and an official URL.

## 8. Suggested production hardening

Before real deployment:

- Replace the public map services with services suitable for your usage and region.
- Add rate limiting, abuse prevention, request quotas and monitoring to the AI Edge Function.
- Review Supabase RLS policies with an experienced security reviewer; add database backups and retention/deletion controls.
- Add official-source verification workflow, audit trails and freshness reminders for helplines and SafeHaven listings.
- Add a proper privacy notice, consent management, retention limits, account deletion and data export.
- Add a professional E2EE implementation with key verification/recovery and an independent cryptographic audit.
- Use native mobile technology (e.g. Expo React Native) if you need dependable background location, push notifications and platform emergency integrations. Browser PWAs cannot guarantee continuous background GPS.
- Do not claim crime prediction. Present route context and support-point coverage transparently with data provenance and timestamps.

## 9. Team split suggestion

- Frontend: route planner, map, SafeHaven and responsive UI.
- Backend: Supabase schema, Auth, RLS, admin queue and helpline records.
- Chat/security: AI Edge Function, consent flow, E2EE proof-of-concept, testing and demo story.

## Official references

- India ERSS 112: https://112.gov.in/
- Ministry of Home Affairs ERSS: https://www.mha.gov.in/emergency-response-support-system-erss
- Women Helpline 181: https://www.wcd.gov.in/public/women/help
- National helpline directory: https://www.india.gov.in/directory/helpline
- Gemini API pricing and limits: https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/rate-limits
- OpenRouter free models: https://openrouter.ai/collections/free-models/
- Supabase pricing: https://supabase.com/pricing
- OpenRouteService API and plans: https://openrouteservice.org/ and https://staging.openrouteservice.org/plans/
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- OSM tile usage policy: https://operations.osmfoundation.org/policies/tiles/
