import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle, ArrowRight, Bot, Check, CheckCircle2, ChevronDown, CircleHelp,
  Compass, Eye, EyeOff, ExternalLink, HeartHandshake, KeyRound, Lock, LockKeyhole,
  LogIn, LogOut, MapPin, Menu, MessageCircle, Navigation, Phone, Plus, RefreshCw,
  Search, Send, Shield, ShieldCheck, Siren, Sparkles, Users, X,
} from 'lucide-react';
import MapView from './components/MapView';
import LocationAutocomplete from './components/LocationAutocomplete';
import { getCurrentPosition, geocode, getDrivingRoutes, formatRouteItems, type PlaceResult } from './lib/geo';
import { decryptForUser, encryptForParticipants, unlockOrCreateKeys } from './lib/e2ee';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import type { Coordinates, Helpline, Profile, RouteOption, SafePlace } from './lib/types';

const INDIA_HELPLINES: Helpline[] = [
  { id: 'fallback-112', country: 'India', state: null, city: null, name: 'Emergency Response Support System', category: 'All emergencies', number: '112', description: 'Pan-India emergency response number for police, fire, health and other emergencies.', is_toll_free: true, availability: '24×7', official_url: 'https://112.gov.in/', is_active: true, verified_at: '2026-11-05' },
  { id: 'fallback-181', country: 'India', state: null, city: null, name: 'Women Helpline', category: 'Women support', number: '181', description: 'Women seeking support or information; connects with emergency services and One Stop Centres.', is_toll_free: true, availability: '24×7 (check local implementation)', official_url: 'https://www.wcd.gov.in/public/women/help', is_active: true, verified_at: '2026-11-05' },
  { id: 'fallback-1930', country: 'India', state: null, city: null, name: 'Cyber Crime Helpline', category: 'Cybercrime', number: '1930', description: 'National cybercrime financial fraud reporting helpline.', is_toll_free: true, availability: 'Check current operating hours', official_url: 'https://www.cybercrime.gov.in/', is_active: true, verified_at: '2026-11-05' },
  { id: 'fallback-102', country: 'India', state: null, city: null, name: 'National Ambulance Service', category: 'Medical', number: '102', description: 'Ambulance service; availability and routing can vary by state.', is_toll_free: true, availability: 'Varies by state', official_url: 'https://www.india.gov.in/', is_active: true, verified_at: '2026-11-05' },
  { id: 'fallback-101', country: 'India', state: null, city: null, name: 'Fire & Rescue', category: 'Fire', number: '101', description: 'Fire emergency helpline listed on the National Portal of India.', is_toll_free: true, availability: 'Check local availability', official_url: 'https://www.india.gov.in/directory/helpline', is_active: true, verified_at: '2026-11-05' },
];

type Tab = 'route' | 'places' | 'assistant' | 'helplines' | 'admin';
type ChatMode = 'ai' | 'private';
type ChatLine = { role: 'user' | 'assistant'; content: string; created_at?: string };
type Suggestion = {
  id: string; name: string; category: string; description: string | null; address: string;
  city: string; state: string; country: string; latitude: number; longitude: number;
  phone: string | null; opening_hours: string | null; status: string; created_at: string;
};
type SupportMessage = { id: string; user_id: string; role: 'user' | 'assistant'; content: string; created_at: string; profiles?: { display_name: string; handle: string } | null };
type PrivateMessage = {
  id: string; sender_id: string; recipient_id: string; ciphertext: string; iv: string;
  wrapped_keys: Record<string, string>; created_at: string;
};

const NAV: { id: Tab; label: string; icon: typeof Navigation }[] = [
  { id: 'route', label: 'SafeRoute', icon: Navigation },
  { id: 'places', label: 'SafeHaven', icon: MapPin },
  { id: 'assistant', label: 'Chat & Support', icon: MessageCircle },
  { id: 'helplines', label: 'Helplines', icon: Phone },
];

function App() {
  const [tab, setTab] = useState<Tab>('route');
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [places, setPlaces] = useState<SafePlace[]>([]);
  const [helplines, setHelplines] = useState<Helpline[]>(INDIA_HELPLINES);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data } = await supabase.from('profiles').select('id,handle,display_name,role,public_key_jwk').eq('id', userId).maybeSingle();
    setProfile(data as Profile | null);
  }, []);

  const loadPublicData = useCallback(async () => {
    if (!supabase) return;
    setLoadingPlaces(true);
    const [placeResult, helplineResult] = await Promise.all([
      supabase.from('safe_places').select('*').eq('status', 'verified').order('name').limit(500),
      supabase.from('helplines').select('*').eq('is_active', true).order('country').limit(1000),
    ]);
    if (!placeResult.error && placeResult.data) setPlaces(placeResult.data as SafePlace[]);
    if (!helplineResult.error && helplineResult.data?.length) setHelplines(helplineResult.data as Helpline[]);
    setLoadingPlaces(false);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) loadProfile(nextSession.user.id);
      else setProfile(null);
    });
    return () => data.subscription.unsubscribe();
  }, [loadProfile]);

  useEffect(() => { loadPublicData(); }, [loadPublicData]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const isAdmin = profile?.role === 'admin';
  const activeTab = tab === 'admin' && !isAdmin ? 'route' : tab;

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null); setProfile(null); setNotice('You have signed out.'); setTab('route'); setMobileMenuOpen(false);
  }

  return (
    <div className="app-root">
      <header className="topbar">
        <button
          type="button"
          className="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <button className="brand" onClick={() => { setTab('route'); setMobileMenuOpen(false); }} aria-label="SafeRoute home">
          <span className="brand-mark"><ShieldCheck size={21} /></span>
          <span><strong>safe<span>route</span></strong><small>WOMEN'S SAFETY ECOSYSTEM</small></span>
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          {NAV.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><Icon size={16} />{item.label}</button>;
          })}
          {isAdmin && <button className={`nav-item ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')}><Shield size={16} />Admin</button>}
        </nav>
        <div className="top-actions">
          {session ? <><span className="user-chip"><span className="avatar">{(profile?.display_name || 'U').slice(0, 1).toUpperCase()}</span><span>{profile?.display_name || 'Member'}</span></span><button className="icon-btn" onClick={handleSignOut} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button></> : <button className="button button-dark button-small" onClick={() => setAuthOpen(true)}><LogIn size={15} /> Sign in</button>}
        </div>
        {mobileMenuOpen && (
          <>
            <button className="mobile-menu-backdrop" type="button" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />
            <nav className="mobile-nav-panel" id="mobile-navigation" aria-label="Mobile navigation">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} className={`nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => { setTab(item.id); setMobileMenuOpen(false); }}>
                    <Icon size={18} /> <span>{item.label}</span>
                  </button>
                );
              })}
              {isAdmin && (
                <button className={`nav-item ${tab === 'admin' ? 'active' : ''}`} onClick={() => { setTab('admin'); setMobileMenuOpen(false); }}>
                  <Shield size={18} /> <span>Admin dashboard</span>
                </button>
              )}
              {session && <div className="mobile-menu-account"><span className="avatar">{(profile?.display_name || 'U').slice(0, 1).toUpperCase()}</span><span>{profile?.display_name || 'Member'}</span></div>}
              {!session && <button className="button button-dark button-full mobile-menu-signin" onClick={() => { setAuthOpen(true); setMobileMenuOpen(false); }}><LogIn size={16} /> Sign in</button>}
              {session && <button className="button button-outline button-full mobile-menu-signout" onClick={handleSignOut}><LogOut size={16} /> Sign out</button>}
            </nav>
          </>
        )}
      </header>

      {!isSupabaseConfigured && <div className="setup-banner"><AlertCircle size={16} /> Preview mode: add Supabase credentials and run the included SQL migration to enable accounts, chat, live data and admin features.</div>}
      {notice && <div className="notice-banner"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}
      {error && <div className="error-banner"><AlertCircle size={16} />{error}<button onClick={() => setError('')}><X size={14} /></button></div>}

      <main className="page-wrap">
        {activeTab === 'route' && <SafeRoutePage places={places} session={session} setAuthOpen={setAuthOpen} setError={setError} />}
        {activeTab === 'places' && <SafeHavenPage places={places} loading={loadingPlaces} session={session} setAuthOpen={setAuthOpen} setNotice={setNotice} setError={setError} refresh={loadPublicData} />}
        {activeTab === 'assistant' && <AssistantPage session={session} profile={profile} setAuthOpen={setAuthOpen} setError={setError} setNotice={setNotice} />}
        {activeTab === 'helplines' && <HelplinesPage helplines={helplines} />}
        {activeTab === 'admin' && isAdmin && <AdminPage setNotice={setNotice} setError={setError} refresh={loadPublicData} />}
      </main>
      <footer className="footer"><span>SafeRoute · Prototype for women's safety and support</span><span>Map data © OpenStreetMap contributors</span><span className="footer-links"><a href="https://112.gov.in/" target="_blank" rel="noreferrer">India emergency support <ExternalLink size={11} /></a></span></footer>
      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} setNotice={setNotice} setError={setError} />}
    </div>
  );
}

function SafeRoutePage({ places, session, setAuthOpen, setError }: { places: SafePlace[]; session: any; setAuthOpen: (value: boolean) => void; setError: (value: string) => void }) {
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [travelMode, setTravelMode] = useState<'driving' | 'walking'>('driving');
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [destination, setDestination] = useState<Coordinates | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [pickOnMap, setPickOnMap] = useState<'origin' | 'destination' | null>(null);

  async function useMyLocation() {
    try { setGeoBusy(true); const point = await getCurrentPosition(); setOrigin(point); setOriginText('My current location'); setPickOnMap(null); }
    catch (e) { setError((e as Error).message); }
    finally { setGeoBusy(false); }
  }

  async function planRoute(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!originText.trim() || !destinationText.trim()) { setError('Enter both a starting point and destination.'); return; }
    try {
      setBusy(true); setRoutes([]);
      const start = origin ?? await geocode(originText);
      const end = destination ?? await geocode(destinationText);
      setOrigin({ lat: start.lat, lon: start.lon }); setDestination({ lat: end.lat, lon: end.lon });
      if (
        !origin &&
        'label' in start &&
        typeof start.label === 'string'
      ) {
        setOriginText(start.label);
      }

      if (
        !destination &&
        'label' in end &&
        typeof end.label === 'string'
      ) {
        setDestinationText(end.label);
      }
      let results: RouteOption[];
      if (travelMode === 'driving') {
        results = await getDrivingRoutes(start, end, places);
      } else {
        if (!session || !supabase) { setError('Sign in and configure the OpenRouteService routing function to use walking routes.'); setAuthOpen(true); return; }
        const { data, error } = await supabase.functions.invoke('route-planner', {
          body: { profile: 'foot-walking', start: [start.lon, start.lat], end: [end.lon, end.lat] },
        });
        if (error) throw error;
        if (!data?.routes?.length) throw new Error(data?.error || 'No walking route was returned.');
        results = formatRouteItems(data.routes.map((route: any) => ({ coordinates: route.coordinates, distance: route.distance, duration: route.duration })), places);
      }
      setRoutes(results); setSelectedRoute(0);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const selected = routes[selectedRoute] ?? null;
  return (
    <>
      <section className="hero hero-route">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse-dot" /> CONTEXT-AWARE JOURNEY PLANNING</div>
          <h1>Move with more<br /><em>confidence.</em></h1>
          <p>Compare routes and discover verified assistance points nearby. SafeRoute helps you make more informed travel choices — it does not guarantee that a route is safe.</p>
          <div className="hero-stats"><div><strong>{places.length || '—'}</strong><span>Verified places</span></div><div><strong>Open</strong><span>Map data</span></div><div><strong>24/7</strong><span>Help access</span></div></div>
        </div>
        <div className="route-search-card">
          <div className="card-heading"><div><span className="mini-icon"><Compass size={17} /></span><strong>Plan a safer journey</strong></div><span className="live-label">ROUTE PLANNER</span></div>
          <form onSubmit={planRoute} className="route-form">
            <label className="field-label">TRAVEL MODE</label>
            <div className="travel-mode-row"><button type="button" className={travelMode === 'walking' ? 'travel-mode active' : 'travel-mode'} onClick={() => setTravelMode('walking')}><Navigation size={14} /> Walking</button><button type="button" className={travelMode === 'driving' ? 'travel-mode active' : 'travel-mode'} onClick={() => setTravelMode('driving')}><Compass size={14} /> Driving</button></div>
            <label className="field-label">STARTING POINT</label>
            <div className="location-field-row"><div className="location-field-grow"><LocationAutocomplete marker="start" value={originText} placeholder="Search address, street, building or landmark" onTextChange={(value) => { setOriginText(value); setOrigin(null); }} onSelect={(place: PlaceResult) => { setOrigin({ lat: place.lat, lon: place.lon }); setOriginText(place.label); }} onPickOnMap={() => setPickOnMap('origin')} /></div><button type="button" className="inline-action gps-action" onClick={useMyLocation} disabled={geoBusy} title="Use current location"><Navigation size={16} />{geoBusy ? 'Locating' : 'Use GPS'}</button></div>
            <div className="route-connector" />
            <label className="field-label">DESTINATION</label>
            <LocationAutocomplete marker="end" value={destinationText} placeholder="Search any address, street, building or landmark" onTextChange={(value) => { setDestinationText(value); setDestination(null); }} onSelect={(place: PlaceResult) => { setDestination({ lat: place.lat, lon: place.lon }); setDestinationText(place.label); }} onPickOnMap={() => setPickOnMap('destination')} />
            <button className="button button-green button-full" disabled={busy}>{busy ? <><RefreshCw className="spin" size={16} /> Finding routes…</> : <>Compare routes <ArrowRight size={16} /></>}</button>
          </form>
          <div className="privacy-footnote"><ShieldCheck size={14} /> Your location is only requested when you choose to use GPS.</div>
        </div>
      </section>

      <section className="content-grid route-results-grid">
        <div className="section-heading"><div><span className="eyebrow">YOUR JOURNEY</span><h2>Route intelligence</h2></div><span className="muted-small">{routes.length ? `${routes.length} option${routes.length > 1 ? 's' : ''} found` : 'Waiting for a route'}</span></div>
        {pickOnMap && <div className="map-pick-banner"><MapPin size={16} /><span>Click anywhere on the map to set your <strong>{pickOnMap === 'origin' ? 'starting point' : 'destination'}</strong>. Zoom in for a more precise location.</span><button type="button" onClick={() => setPickOnMap(null)}>Cancel</button></div>}
        <div className="map-panel"><MapView places={places} route={selected} origin={origin} destination={destination} height={430} onMapClick={pickOnMap ? (point) => { if (pickOnMap === 'origin') { setOrigin(point); setOriginText(`Pinned point (${point.lat.toFixed(6)}, ${point.lon.toFixed(6)})`); } else { setDestination(point); setDestinationText(`Pinned point (${point.lat.toFixed(6)}, ${point.lon.toFixed(6)})`); } setPickOnMap(null); setRoutes([]); } : undefined} /></div>
        <div className="route-explainer"><ShieldCheck size={17} /><span>“Nearby support points” counts verified SafeHaven locations close to the route. It is a coverage indicator, not a crime prediction or a safety guarantee.</span></div>
        {routes.length > 0 ? <div className="route-options">{routes.map((route, index) => <button key={index} className={`route-option ${selectedRoute === index ? 'selected' : ''}`} onClick={() => setSelectedRoute(index)}><span className="route-radio">{selectedRoute === index && <span />}</span><span className="route-option-main"><strong>{route.label}</strong><small>{route.supportPointsNearby} verified support point{route.supportPointsNearby === 1 ? '' : 's'} within approx. 700 m</small></span><span className="route-metrics"><strong>{route.distanceKm.toFixed(1)} km</strong><small>{Math.round(route.durationMin)} min</small></span></button>)}</div> : <div className="empty-state compact"><div className="empty-icon"><Navigation size={20} /></div><strong>Your route comparison will appear here</strong><span>Enter your start and destination above to compare available driving routes.</span></div>}
      </section>
      <section className="below-grid">
        <div className="info-card"><span className="info-icon green"><MapPin size={18} /></span><div><strong>Verified help points</strong><p>Look for verified police stations, hospitals, pharmacies and participating assistance locations along your journey.</p></div></div>
        <div className="info-card"><span className="info-icon blue"><HeartHandshake size={18} /></span><div><strong>Not sure what to do?</strong><p>Use the support assistant for guidance, or open the emergency directory to contact a service directly.</p></div></div>
      </section>
    </>
  );
}

function SafeHavenPage({ places, loading, session, setAuthOpen, setNotice, setError, refresh }: {
  places: SafePlace[]; loading: boolean; session: any; setAuthOpen: (value: boolean) => void;
  setNotice: (value: string) => void; setError: (value: string) => void; refresh: () => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'Assistance point', description: '', address: '', city: '', state: '', country: 'India', latitude: '', longitude: '', phone: '', opening_hours: '' });
  const categories = ['All', ...Array.from(new Set(places.map((place) => place.category))).sort()];
  const filtered = places.filter((place) => (category === 'All' || place.category === category) && `${place.name} ${place.address} ${place.city} ${place.state}`.toLowerCase().includes(search.toLowerCase()));

  async function suggestPlace(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!session || !supabase) { setAuthOpen(true); return; }
    if (!form.name || !form.address || !form.city || !form.state || !form.latitude || !form.longitude) { setError('Please complete the place name, address, city, state and coordinates.'); return; }
    const lat = Number(form.latitude), lon = Number(form.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { setError('Enter valid latitude and longitude values.'); return; }
    try {
      setSaving(true);
      const { error } = await supabase.from('place_suggestions').insert({ ...form, latitude: lat, longitude: lon, status: 'pending', submitted_by: session.user.id });
      if (error) throw error;
      setFormOpen(false); setNotice('Thanks. Your place suggestion has been sent for verification.');
      setForm({ name: '', category: 'Assistance point', description: '', address: '', city: '', state: '', country: 'India', latitude: '', longitude: '', phone: '', opening_hours: '' });
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <section className="page-intro"><div><div className="eyebrow">COMMUNITY-VERIFIED SUPPORT</div><h1>SafeHaven <em>network.</em></h1><p>Discover assistance points where someone may be able to help — and suggest places for the community to verify.</p></div><button className="button button-green" onClick={() => session ? setFormOpen((v) => !v) : setAuthOpen(true)}><Plus size={16} /> Suggest a place</button></section>
      <div className="places-toolbar"><div className="searchbox"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by place, area or city" /></div><div className="filter-pills">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? 'filter-pill active' : 'filter-pill'}>{item}</button>)}</div></div>
      {formOpen && <form className="suggest-form panel" onSubmit={suggestPlace}><div className="panel-head"><div><strong>Suggest a SafeHaven</strong><small>New places remain pending until an admin verifies them.</small></div><button type="button" className="icon-btn" onClick={() => setFormOpen(false)}><X size={17} /></button></div><div className="form-grid">
        <Field label="PLACE NAME"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. City Central Hospital" /></Field>
        <Field label="CATEGORY"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Assistance point</option><option>Police station</option><option>Hospital</option><option>Pharmacy</option><option>Verified shop</option><option>Public facility</option></select></Field>
        <Field label="ADDRESS"><input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street / landmark" /></Field>
        <Field label="CITY"><input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
        <Field label="STATE / REGION"><input required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
        <Field label="COUNTRY"><input required value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
        <Field label="LATITUDE"><input required value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="e.g. 23.8315" /></Field>
        <Field label="LONGITUDE"><input required value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="e.g. 91.2868" /></Field>
        <Field label="PHONE (OPTIONAL)"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="OPENING HOURS (OPTIONAL)"><input value={form.opening_hours} onChange={(e) => setForm({ ...form, opening_hours: e.target.value })} /></Field>
        <Field label="DESCRIPTION" wide><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Why is this a useful assistance point? Avoid sharing private information." /></Field>
      </div><div className="form-actions"><span className="muted-small">Please submit only places you can reasonably verify.</span><button className="button button-green" disabled={saving}>{saving ? 'Submitting…' : 'Submit for verification'}</button></div></form>}
      <div className="safehaven-layout"><div className="map-panel"><MapView places={filtered} height={540} /></div><div className="place-list-panel"><div className="list-head"><div><strong>Verified assistance points</strong><small>{filtered.length} places listed</small></div><button className="icon-btn" onClick={refresh} title="Refresh"><RefreshCw size={16} /></button></div>{loading ? <Loading /> : filtered.length ? filtered.map((place) => <div className="place-card" key={place.id}><div className="place-category-icon"><MapPin size={17} /></div><div className="place-card-body"><strong>{place.name}</strong><span className="place-category">{place.category}</span><p>{place.address}, {place.city}, {place.state}</p><div className="place-meta">{place.opening_hours && <span>{place.opening_hours}</span>}{place.phone && <a href={`tel:${place.phone}`}><Phone size={12} />{place.phone}</a>}</div><span className="verified-text"><CheckCircle2 size={12} /> Admin verified</span></div></div>) : <div className="empty-state"><MapPin size={22} /><strong>No verified places found</strong><span>Try another search or suggest a place for verification.</span></div>}</div></div>
      <div className="caution-note"><ShieldCheck size={17} /><span>Verification confirms that a listing was reviewed; it does not certify that a location is always safe, open or able to provide assistance. Call ahead when possible.</span></div>
    </>
  );
}

function AssistantPage({ session, profile, setAuthOpen, setError, setNotice }: { session: any; profile: Profile | null; setAuthOpen: (value: boolean) => void; setError: (value: string) => void; setNotice: (value: string) => void }) {
  const [mode, setMode] = useState<ChatMode>('ai');
  const [consent, setConsent] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState<ChatLine[]>([]);
  const [recipientHandle, setRecipientHandle] = useState('');
  const [recipient, setRecipient] = useState<Profile | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [selfPublicJwk, setSelfPublicJwk] = useState<JsonWebKey | null>(profile?.public_key_jwk ?? null);
  const [privateUnlocked, setPrivateUnlocked] = useState(false);
  useEffect(() => { setSelfPublicJwk(profile?.public_key_jwk ?? null); }, [profile?.public_key_jwk]);
  const [privateInput, setPrivateInput] = useState('');
  const [privateMessages, setPrivateMessages] = useState<Array<{ id: string; sender_id: string; content: string; created_at: string }>>([]);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

  async function sendAiMessage(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!session || !supabase) { setAuthOpen(true); return; }
    if (!consent) { setError('Please review and accept the AI chat disclosure before continuing.'); return; }
    const text = aiInput.trim(); if (!text || aiBusy) return;
    if (text.length > 3000) { setError('Please keep each message under 3,000 characters.'); return; }
    setAiInput(''); setAiBusy(true);
    const next = [...aiMessages, { role: 'user' as const, content: text }];
    setAiMessages(next);
    try {
      const { error: userLogError } = await supabase.from('support_chat_messages').insert({ user_id: session.user.id, role: 'user', content: text });
      if (userLogError) throw userLogError;
      const { data, error: fnError } = await supabase.functions.invoke('ai-chat', { body: { message: text, history: next.slice(-8) } });
      if (fnError) throw fnError;
      const answer = String(data?.reply || 'I could not generate a response. Please try again.');
      const { error: assistantLogError } = await supabase.from('support_chat_messages').insert({ user_id: session.user.id, role: 'assistant', content: answer });
      if (assistantLogError) throw assistantLogError;
      setAiMessages((items) => [...items, { role: 'assistant', content: answer }]);
    } catch (e) {
      setError(`AI assistant error: ${(e as Error).message}. Check that the Edge Function and AI provider secret are configured.`);
    } finally { setAiBusy(false); }
  }

  async function unlockPrivateChat() {
    setError('');
    if (!session || !supabase || !profile) { setAuthOpen(true); return; }
    try {
      setPrivateBusy(true);
      const result = await unlockOrCreateKeys(session.user.id, passphrase);
      const replacingKey = result.created && Boolean(profile.public_key_jwk);
      const { error } = await supabase.from('profiles').update({ public_key_jwk: result.publicJwk }).eq('id', session.user.id);
      if (error) throw error;
      setPrivateKey(result.privateKey); setSelfPublicJwk(result.publicJwk); setPrivateUnlocked(true);
      if (replacingKey) setNotice('A new key was registered. Messages encrypted to your previous key may no longer be readable. Keep this browser storage and passphrase safe.');
      else if (result.created) setNotice('A new private-chat key was created on this browser. Keep this browser storage and passphrase safe; there is no cloud key recovery in this prototype.');
      else setNotice('Private chat unlocked on this device.');
    } catch (e) { setError((e as Error).message); }
    finally { setPrivateBusy(false); }
  }

  async function findRecipient(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!supabase || !session) { setAuthOpen(true); return; }
    const handle = recipientHandle.trim().replace(/^@/, '').toLowerCase();
    if (!handle) return;
    const { data, error } = await supabase.from('profiles').select('id,handle,display_name,role,public_key_jwk').eq('handle', handle).maybeSingle();
    if (error || !data) { setError('No account found with that username.'); return; }
    if (data.id === session.user.id) { setError('You cannot start a private chat with yourself.'); return; }
    if (!data.public_key_jwk) { setError('This person has not set up private chat on their device yet. Ask them to unlock Private Chat once.'); return; }
    setRecipient(data as Profile); setPrivateMessages([]);
  }

  const loadThread = useCallback(async () => {
    if (!supabase || !session || !recipient || !privateKey || !privateUnlocked) return;
    setLoadingThread(true);
    try {
      const [sent, received] = await Promise.all([
        supabase.from('private_messages').select('*').eq('sender_id', session.user.id).eq('recipient_id', recipient.id).order('created_at', { ascending: true }).limit(100),
        supabase.from('private_messages').select('*').eq('sender_id', recipient.id).eq('recipient_id', session.user.id).order('created_at', { ascending: true }).limit(100),
      ]);
      if (sent.error) throw sent.error;
      if (received.error) throw received.error;
      const rows = [...(sent.data || []), ...(received.data || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)) as PrivateMessage[];
      const decrypted = await Promise.all(rows.map(async (row) => {
        try { return { id: row.id, sender_id: row.sender_id, content: await decryptForUser(row, session.user.id, privateKey), created_at: row.created_at }; }
        catch { return { id: row.id, sender_id: row.sender_id, content: '[Unable to decrypt this message on this device]', created_at: row.created_at }; }
      }));
      setPrivateMessages(decrypted);
    } catch (e) { setError((e as Error).message); }
    finally { setLoadingThread(false); }
  }, [session, recipient, privateKey, privateUnlocked, setError]);

  useEffect(() => { loadThread(); }, [loadThread]);

  async function sendPrivateMessage(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!supabase || !session || !profile || !recipient || !privateKey || !selfPublicJwk) { setError('Unlock private chat and select a recipient first.'); return; }
    const text = privateInput.trim(); if (!text || privateBusy) return;
    if (text.length > 2000) { setError('Please keep each private message under 2,000 characters.'); return; }
    try {
      setPrivateBusy(true);
      const encrypted = await encryptForParticipants(text, session.user.id, recipient.id, selfPublicJwk, recipient.public_key_jwk!);
      const { error } = await supabase.from('private_messages').insert({ sender_id: session.user.id, recipient_id: recipient.id, ...encrypted });
      if (error) throw error;
      setPrivateInput(''); await loadThread();
    } catch (e) { setError((e as Error).message); }
    finally { setPrivateBusy(false); }
  }

  return (
    <>
      <section className="page-intro assistant-intro"><div><div className="eyebrow">SUPPORT WITHOUT JUDGEMENT</div><h1>You're not alone.<br /><em>We're here to listen.</em></h1><p>Choose an AI support conversation with disclosed logging, or a separate encrypted chat with someone you trust.</p></div><div className="assistant-orb"><div className="orb-inner"><HeartHandshake size={37} /></div><span className="orb-ring ring-one" /><span className="orb-ring ring-two" /></div></section>
      <div className="chat-mode-switch"><button className={mode === 'ai' ? 'mode-tab active' : 'mode-tab'} onClick={() => setMode('ai')}><Bot size={17} /> AI Support Chat <span className="mode-tag">AI</span></button><button className={mode === 'private' ? 'mode-tab active' : 'mode-tab'} onClick={() => setMode('private')}><LockKeyhole size={17} /> Private E2EE Chat <span className="mode-tag encrypted">LOCKED</span></button></div>
      {mode === 'ai' ? <div className="chat-layout"><aside className="chat-info"><div className="chat-info-icon"><Sparkles size={21} /></div><h3>AI Support Companion</h3><p>A non-judgmental place to organise your thoughts, understand options and find relevant support resources.</p><div className="info-divider" /><div className="info-check"><Check size={15} /> General safety planning</div><div className="info-check"><Check size={15} /> Guidance on reporting options</div><div className="info-check"><Check size={15} /> Help finding support services</div><div className="chat-disclaimer"><AlertCircle size={16} /><span>Not an emergency service, lawyer, therapist or a substitute for trusted human support.</span></div></aside>
        <div className="chat-panel"><div className="chat-panel-head"><div className="assistant-avatar"><Bot size={20} /></div><div><strong>SafeRoute Assistant</strong><small><span className="online-dot" /> AI support · not monitored live</small></div><span className="chat-head-pill">AI MODE</span></div>
          {!consent ? <div className="consent-screen"><div className="consent-icon"><Eye size={22} /></div><h3>Before you start</h3><p>This AI conversation is sent to an external AI provider and saved in SafeRoute's support chat records. Authorised administrators may review these records for support operations and abuse prevention.</p><p>Do not share passwords, identity numbers, exact home addresses, highly sensitive evidence or anything you would not want an AI provider to process. The free AI provider may have its own data handling terms.</p><label className="consent-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I understand that this AI chat is not end-to-end encrypted and may be reviewed by authorised admins.</span></label><button className="button button-green button-full" disabled={!consent} onClick={() => setAiMessages([{ role: 'assistant', content: 'Hi. I’m here to help you think through your options. You can share only what you feel comfortable sharing. Are you looking for safety planning, information about support services, or help understanding an online or offline incident?' }])}>Continue to AI chat <ArrowRight size={16} /></button></div> : <><div className="chat-messages">{aiMessages.map((message, index) => <div key={index} className={`message-row ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <Bot size={15} /> : (profile?.display_name || 'U').slice(0, 1)}</div><div className="message-bubble">{message.content}</div></div>)}{aiBusy && <div className="message-row assistant"><div className="message-avatar"><Bot size={15} /></div><div className="message-bubble typing"><i /><i /><i /></div></div>}</div><form className="chat-compose" onSubmit={sendAiMessage}><textarea value={aiInput} onChange={(e) => setAiInput(e.target.value)} placeholder="Share only what you're comfortable sharing…" rows={2} /><button className="send-button" disabled={aiBusy || !aiInput.trim()}><Send size={17} /></button></form><div className="chat-bottom-note"><Lock size={12} /> AI chat is logged for authorised admin review. <button onClick={() => { setConsent(false); setAiMessages([]); }}>End chat</button></div></>}
        </div></div> : <div className="private-layout"><aside className="private-explainer"><div className="private-shield"><LockKeyhole size={27} /></div><h3>Private means private.</h3><p>Messages are encrypted in your browser before they reach the database. Only the sender and recipient have the keys needed to read them.</p><div className="privacy-bullets"><div><CheckCircle2 size={15} /> No AI processing</div><div><CheckCircle2 size={15} /> No readable admin history</div><div><CheckCircle2 size={15} /> AES-GCM message encryption</div><div><CheckCircle2 size={15} /> RSA-OAEP key wrapping</div></div><div className="chat-disclaimer"><AlertCircle size={16} /><span>This is a hackathon prototype. Keep your passphrase safe. Clearing browser storage can permanently remove your private key.</span></div></aside>
        <div className="chat-panel private-chat-panel"><div className="chat-panel-head"><div className="assistant-avatar private-avatar"><LockKeyhole size={18} /></div><div><strong>Encrypted private chat</strong><small><span className="online-dot green-dot" /> Messages encrypted on this device</small></div><span className="chat-head-pill encrypted-pill">E2EE</span></div>
          {!session ? <div className="consent-screen"><div className="consent-icon"><LockKeyhole size={22} /></div><h3>Sign in to use private chat</h3><p>You need an account to create your encryption keys and find a trusted contact.</p><button className="button button-green" onClick={() => setAuthOpen(true)}>Sign in or create account</button></div> : !privateUnlocked ? <div className="consent-screen"><div className="consent-icon"><KeyRound size={22} /></div><h3>Unlock your private key</h3><p>Create a long passphrase. It protects your private key locally and is never uploaded to the server.</p><form className="unlock-form" onSubmit={(e) => { e.preventDefault(); unlockPrivateChat(); }}><input type="password" minLength={10} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="At least 10 characters" autoComplete="new-password" /><button className="button button-green button-full" disabled={privateBusy}>{privateBusy ? 'Unlocking…' : 'Create / unlock key'}</button></form><p className="tiny-note">For this prototype, your encrypted key vault is stored in this browser. There is no automatic key recovery.</p></div> : <><div className="recipient-bar"><form onSubmit={findRecipient}><input value={recipientHandle} onChange={(e) => setRecipientHandle(e.target.value)} placeholder="Enter trusted person's @username" /><button className="button button-outline button-small"><Search size={14} /> Find</button></form>{recipient && <div className="recipient-selected"><span className="avatar">{recipient.display_name.slice(0, 1).toUpperCase()}</span><span><strong>{recipient.display_name}</strong><small>@{recipient.handle}</small></span><span className="encrypted-inline"><Lock size={12} /> encrypted</span></div>}</div>
            {!recipient ? <div className="empty-state chat-empty"><Users size={24} /><strong>Choose someone you trust</strong><span>Ask them to create an account and unlock Private Chat once. Then enter their username above.</span></div> : <><div className="private-message-list">{loadingThread ? <Loading /> : privateMessages.length ? privateMessages.map((message) => <div key={message.id} className={`message-row ${message.sender_id === session.user.id ? 'user' : 'assistant'}`}><div className="message-avatar">{message.sender_id === session.user.id ? 'You' : recipient.display_name.slice(0, 1)}</div><div className="message-bubble">{message.content}<small>{new Date(message.created_at).toLocaleString()}</small></div></div>) : <div className="empty-state chat-empty"><LockKeyhole size={22} /><strong>Messages are end-to-end encrypted</strong><span>No messages yet. Start the conversation below.</span></div>}</div><form className="chat-compose" onSubmit={sendPrivateMessage}><textarea value={privateInput} onChange={(e) => setPrivateInput(e.target.value)} placeholder="Write an encrypted message…" rows={2} /><button className="send-button" disabled={privateBusy || !privateInput.trim()}><Send size={17} /></button></form><div className="chat-bottom-note"><Lock size={12} /> Encrypted before upload · <button onClick={loadThread}>Refresh messages</button></div></>}
          </>}
        </div></div>}
    </>
  );
}

function HelplinesPage({ helplines }: { helplines: Helpline[] }) {
  const [country, setCountry] = useState('India');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [query, setQuery] = useState('');
  const availableCountries = Array.from(new Set(helplines.map((item) => item.country))).sort();
  const filtered = helplines.filter((item) => item.country.toLowerCase() === country.toLowerCase())
    .filter((item) => !state || !item.state || item.state.toLowerCase() === state.toLowerCase())
    .filter((item) => !city || !item.city || item.city.toLowerCase() === city.toLowerCase())
    .filter((item) => `${item.name} ${item.category} ${item.number} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  const regional = filtered.sort((a, b) => Number(Boolean(b.city)) - Number(Boolean(a.city)) || Number(Boolean(b.state)) - Number(Boolean(a.state)));
  return (
    <>
      <section className="page-intro helpline-intro"><div><div className="eyebrow">HELP WHEN IT MATTERS</div><h1>Emergency <em>directory.</em></h1><p>Find official emergency and support numbers by country, state and city. Always verify local coverage before relying on a non-national listing.</p></div><div className="emergency-call-card"><span className="emergency-icon"><Siren size={24} /></span><div><small>IMMEDIATE DANGER · INDIA</small><strong>112</strong><a href="tel:112">Call emergency services <ArrowRight size={13} /></a></div></div></section>
      <div className="filter-panel"><div className="filter-grid"><Field label="COUNTRY"><select value={country} onChange={(e) => setCountry(e.target.value)}>{availableCountries.map((item) => <option key={item}>{item}</option>)}{!availableCountries.includes('India') && <option>India</option>}</select></Field><Field label="STATE / REGION (OPTIONAL)"><input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Tripura" /></Field><Field label="CITY (OPTIONAL)"><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Agartala" /></Field><Field label="SEARCH"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Service or number" /></Field></div><div className="muted-small">Showing country-wide numbers plus matching state/city listings.</div></div>
      <div className="helpline-grid">{regional.map((item) => <div className={`helpline-card ${item.number === '112' ? 'primary-helpline' : ''}`} key={item.id}><div className="helpline-top"><span className="helpline-type"><Phone size={14} />{item.category}</span>{item.is_toll_free && <span className="tollfree">TOLL-FREE</span>}</div><h3>{item.name}</h3><div className="helpline-number">{item.number}</div><p>{item.description}</p><div className="helpline-location"><MapPin size={12} />{[item.city, item.state, item.country].filter(Boolean).join(', ')}</div><div className="helpline-foot"><span>{item.availability || 'Check local availability'}</span><a href={`tel:${item.number.replace(/[^+\d]/g, '')}`} className="button button-call"><Phone size={14} /> Call now</a></div>{item.official_url && <a className="official-link" href={item.official_url} target="_blank" rel="noreferrer">Official information <ExternalLink size={12} /></a>}</div>)}{!regional.length && <div className="empty-state"><Phone size={24} /><strong>No matching helplines</strong><span>Try removing the city or state filter, or ask an administrator to add a verified local listing.</span></div>}</div>
      <div className="caution-note"><AlertCircle size={17} /><span>Directory coverage depends on verified records added by administrators. In India, 112 is the nationwide emergency response number and 181 is the national Women Helpline. Some legacy or specialist numbers may vary by state. For immediate danger, call 112.</span></div>
    </>
  );
}

function AdminPage({ setNotice, setError, refresh }: { setNotice: (value: string) => void; setError: (value: string) => void; refresh: () => void }) {
  const [logs, setLogs] = useState<SupportMessage[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [newLine, setNewLine] = useState({ country: 'India', state: '', city: '', name: '', category: 'Women support', number: '', description: '', official_url: '', availability: '24×7', is_toll_free: true });
  const [lineBusy, setLineBusy] = useState(false);

  const loadAdminData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [chatResult, suggestionResult] = await Promise.all([
      supabase.from('support_chat_messages').select('id,user_id,role,content,created_at,profiles(display_name,handle)').order('created_at', { ascending: false }).limit(100),
      supabase.from('place_suggestions').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
    ]);
    if (!chatResult.error) setLogs((chatResult.data || []) as unknown as SupportMessage[]);
    if (!suggestionResult.error) setSuggestions((suggestionResult.data || []) as Suggestion[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadAdminData(); }, [loadAdminData]);

  async function approveSuggestion(item: Suggestion, status: 'verified' | 'rejected') {
    if (!supabase) return;
    setError('');
    try {
      if (status === 'verified') {
        const { error: insertError } = await supabase.from('safe_places').insert({ name: item.name, category: item.category, description: item.description, address: item.address, city: item.city, state: item.state, country: item.country, latitude: item.latitude, longitude: item.longitude, phone: item.phone, opening_hours: item.opening_hours, status: 'verified', verified_at: new Date().toISOString() });
        if (insertError) throw insertError;
      }
      const { error } = await supabase.from('place_suggestions').update({ status, reviewed_at: new Date().toISOString() }).eq('id', item.id);
      if (error) throw error;
      setNotice(`Suggestion ${status}.`); await loadAdminData(); refresh();
    } catch (e) { setError((e as Error).message); }
  }

  async function addHelpline(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setLineBusy(true); setError('');
    try {
      const { error } = await supabase.from('helplines').insert({ ...newLine, state: newLine.state || null, city: newLine.city || null, is_active: true, verified_at: new Date().toISOString() });
      if (error) throw error;
      setNotice('Helpline added to the directory.');
      setNewLine({ country: 'India', state: '', city: '', name: '', category: 'Women support', number: '', description: '', official_url: '', availability: '24×7', is_toll_free: true });
    } catch (e) { setError((e as Error).message); }
    finally { setLineBusy(false); }
  }

  return (
    <>
      <section className="page-intro"><div><div className="eyebrow">OPERATIONS CONSOLE</div><h1>Admin <em>dashboard.</em></h1><p>Review AI support conversations only where users gave notice and consent, verify SafeHaven suggestions and maintain helpline records.</p></div><button className="button button-outline" onClick={loadAdminData}><RefreshCw size={15} /> Refresh data</button></section>
      <div className="admin-metrics"><div className="metric-card"><span>AI SUPPORT MESSAGES</span><strong>{logs.length}</strong><small>Latest 100 messages</small></div><div className="metric-card"><span>PENDING PLACE SUGGESTIONS</span><strong>{suggestions.length}</strong><small>Awaiting review</small></div><div className="metric-card"><span>PRIVACY</span><strong>Split</strong><small>E2EE chats are not accessible here</small></div></div>
      <div className="admin-grid"><section className="panel"><div className="panel-head"><div><strong>SafeHaven verification queue</strong><small>Approve only after checking the location and its details.</small></div><span className="count-pill">{suggestions.length}</span></div>{loading ? <Loading /> : suggestions.length ? suggestions.map((item) => <div className="review-card" key={item.id}><div><strong>{item.name}</strong><span className="place-category">{item.category}</span><p>{item.address}, {item.city}, {item.state}, {item.country}</p><small>{item.latitude}, {item.longitude}</small></div><div className="review-actions"><button className="button button-green button-small" onClick={() => approveSuggestion(item, 'verified')}><Check size={14} /> Verify</button><button className="button button-danger button-small" onClick={() => approveSuggestion(item, 'rejected')}><X size={14} /> Reject</button></div></div>) : <div className="empty-state"><CheckCircle2 size={23} /><strong>No pending suggestions</strong><span>New community submissions will appear here.</span></div>}</section>
        <section className="panel"><div className="panel-head"><div><strong>Add a local helpline</strong><small>Use an official source and keep the verification date current.</small></div><Phone size={18} /></div><form className="admin-helpline-form" onSubmit={addHelpline}><Field label="COUNTRY"><input required value={newLine.country} onChange={(e) => setNewLine({ ...newLine, country: e.target.value })} /></Field><Field label="STATE / REGION"><input value={newLine.state} onChange={(e) => setNewLine({ ...newLine, state: e.target.value })} /></Field><Field label="CITY"><input value={newLine.city} onChange={(e) => setNewLine({ ...newLine, city: e.target.value })} /></Field><Field label="SERVICE NAME"><input required value={newLine.name} onChange={(e) => setNewLine({ ...newLine, name: e.target.value })} /></Field><Field label="CATEGORY"><input required value={newLine.category} onChange={(e) => setNewLine({ ...newLine, category: e.target.value })} /></Field><Field label="PHONE NUMBER"><input required value={newLine.number} onChange={(e) => setNewLine({ ...newLine, number: e.target.value })} /></Field><Field label="OFFICIAL URL"><input value={newLine.official_url} onChange={(e) => setNewLine({ ...newLine, official_url: e.target.value })} /></Field><Field label="AVAILABILITY"><input value={newLine.availability} onChange={(e) => setNewLine({ ...newLine, availability: e.target.value })} /></Field><label className="consent-check"><input type="checkbox" checked={newLine.is_toll_free} onChange={(e) => setNewLine({ ...newLine, is_toll_free: e.target.checked })} /><span>Toll-free number (verify before checking)</span></label><Field label="DESCRIPTION" wide><textarea value={newLine.description} onChange={(e) => setNewLine({ ...newLine, description: e.target.value })} /></Field><button className="button button-green button-full" disabled={lineBusy}>{lineBusy ? 'Saving…' : 'Add helpline'}</button></form></section></div>
      <section className="panel admin-chat-log"><div className="panel-head"><div><strong>AI support chat review</strong><small>Only AI Support Chat logs. E2EE messages are not stored here in readable form.</small></div><Eye size={18} /></div>{logs.length ? logs.map((message) => <div className="log-row" key={message.id}><div className="log-author"><span className="avatar">{message.role === 'assistant' ? 'AI' : (message.profiles?.display_name || 'U').slice(0, 1)}</span><span><strong>{message.profiles?.display_name || 'User'}</strong><small>@{message.profiles?.handle || 'account'} · {message.role}</small></span></div><p>{message.content}</p><time>{new Date(message.created_at).toLocaleString()}</time></div>) : <div className="empty-state"><MessageCircle size={23} /><strong>No AI chat logs yet</strong><span>Consented AI conversations will appear here.</span></div>}</section>
    </>
  );
}

function AuthModal({ mode, setMode, onClose, setNotice, setError }: { mode: 'signin' | 'signup'; setMode: (mode: 'signin' | 'signup') => void; onClose: () => void; setNotice: (value: string) => void; setError: (value: string) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!supabase) { setError('Supabase is not configured. Add the environment variables first.'); return; }
    if (mode === 'signup' && !/^[a-z0-9_]{3,24}$/.test(handle.toLowerCase())) { setError('Username must be 3–24 characters: lowercase letters, numbers or underscores.'); return; }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { handle: handle.toLowerCase(), display_name: displayName.trim() || handle } } });
        if (error) throw error;
        if (!data.session) setNotice('Account created. Check your email to confirm your account, then sign in.');
        else setNotice('Welcome to SafeRoute.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setNotice('Welcome back.');
      }
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="auth-modal"><button className="modal-close" onClick={onClose}><X size={19} /></button><div className="auth-brand"><span className="brand-mark"><ShieldCheck size={21} /></span><strong>safe<span>route</span></strong></div><h2>{mode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h2><p>{mode === 'signin' ? 'Sign in to continue to your safety workspace.' : 'Create an account to use chat and suggest SafeHaven locations.'}</p><form onSubmit={submit}>{mode === 'signup' && <><Field label="YOUR NAME"><input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" /></Field><Field label="USERNAME"><input required value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="e.g. sakhi_24" /></Field></>}<Field label="EMAIL ADDRESS"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></Field><Field label="PASSWORD"><input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></Field><button className="button button-green button-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></button></form><div className="auth-switch">{mode === 'signin' ? 'New to SafeRoute?' : 'Already have an account?'} <button onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>{mode === 'signin' ? 'Create account' : 'Sign in'}</button></div><small className="auth-foot">By continuing, you agree to use this prototype responsibly. Do not rely on it as an emergency dispatch service.</small></div></div>;
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`field ${wide ? 'field-wide' : ''}`}><span>{label}</span>{children}</label>;
}
function Loading() { return <div className="loading-state"><RefreshCw size={17} className="spin" /> Loading…</div>; }

export default App;
