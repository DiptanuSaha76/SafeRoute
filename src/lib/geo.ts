import type { Coordinates, RouteOption, SafePlace } from './types';

export type PlaceResult = Coordinates & {
  label: string;
  name: string;
  source: 'Geoapify' | 'Photon' | 'OpenStreetMap';
};

const cache = new Map<string, PlaceResult[]>();
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function coordinateResult(query: string): PlaceResult[] | null {
  const match = query.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [{ lat, lon, name: 'Pinned coordinates', label: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, source: 'OpenStreetMap' }];
}

function makeLabel(parts: unknown[], fallback: string) {
  const unique = parts.map(clean).filter((part, index, all) => part && all.indexOf(part) === index);
  return unique.join(', ') || fallback;
}

async function searchGeoapify(query: string, limit: number): Promise<PlaceResult[]> {
  const env = import.meta.env as Record<string, string | undefined>;
  const apiKey = env['VITE_GEOAPIFY_API_KEY'];
  if (!apiKey) return [];

  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', 'en');
  url.searchParams.set('apiKey', apiKey);
  if (/\b(india|tripura|gomati|udaipur)\b/i.test(query)) url.searchParams.set('filter', 'countrycode:in');

  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geoapify search failed (${response.status})`);
  const data = await response.json();
  const rows = Array.isArray(data.results) ? data.results : [];
  return rows.flatMap((p: any) => {
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const name = clean(p.name) || clean(p.address_line1) || clean(p.street) || clean(p.suburb) || clean(p.city) || query;
    const label = clean(p.formatted) || makeLabel([
      p.name,
      p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street,
      p.address_line2,
      p.suburb,
      p.city || p.town || p.village,
      p.state,
      p.postcode,
      p.country,
    ], `${lat}, ${lon}`);
    return [{ lat, lon, name, label, source: 'Geoapify' as const }];
  });
}

async function searchPhoton(query: string, limit: number): Promise<PlaceResult[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', 'en');
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Photon search failed (${response.status})`);
  const data = await response.json();
  const features = Array.isArray(data.features) ? data.features : [];
  return features.flatMap((feature: any) => {
    const coords = feature?.geometry?.coordinates;
    const p = feature?.properties ?? {};
    if (!Array.isArray(coords) || coords.length < 2) return [];
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const name = clean(p.name) || clean(p.street) || clean(p.locality) || clean(p.district) || clean(p.city) || query;
    const label = makeLabel([
      p.name,
      p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street,
      p.suburb || p.district,
      p.city || p.locality || p.county,
      p.state,
      p.country,
    ], `${lat}, ${lon}`);
    return [{ lat, lon, name, label, source: 'Photon' as const }];
  });
}

function mergeResults(groups: PlaceResult[][], limit: number): PlaceResult[] {
  const seen = new Set<string>();
  const merged: PlaceResult[] = [];
  // Prefer Geoapify's richer address formatting, then Photon results.
  for (const result of groups.flat()) {
    const key = `${result.lat.toFixed(5)}:${result.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
    if (merged.length >= limit) break;
  }
  return merged;
}

/**
 * Search address/place providers in parallel. Geoapify improves address and POI
 * coverage; Photon is an OSM-based fallback. Nominatim's public endpoint is
 * intentionally not used for autocomplete because its usage policy prohibits it.
 */
export async function searchPlaces(query: string, limit = 8): Promise<PlaceResult[]> {
  const text = query.trim().replace(/\s+/g, ' ');
  if (text.length < 2) return [];
  const coords = coordinateResult(text);
  if (coords) return coords;

  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const cacheKey = `${text.toLowerCase()}|${safeLimit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const runProviders = async (searchText: string) => {
    const settled = await Promise.allSettled([
      searchGeoapify(searchText, safeLimit),
      searchPhoton(searchText, safeLimit),
    ]);
    const geo = settled[0].status === 'fulfilled' ? settled[0].value : [];
    const photon = settled[1].status === 'fulfilled' ? settled[1].value : [];
    return mergeResults([geo, photon], safeLimit);
  };

  let results = await runProviders(text);

  // Many Indian addresses are indexed with the country included. Retry once
  // with India when the user supplied a state/city but omitted the country.
  const looksIndian = /\b(india|tripura|gomati|udaipur|manipur|assam|meghalaya|nagaland|mizoram|sikkim|arunachal)\b/i.test(text);
  if (!results.length && looksIndian && !/\bindia\b/i.test(text)) {
    results = await runProviders(`${text}, India`);
  }

  cache.set(cacheKey, results);
  if (cache.size > 150) cache.delete(cache.keys().next().value as string);
  return results;
}

/** Resolve a typed place to the best first result. Prefer searchPlaces for UI selection. */
export async function geocode(query: string): Promise<PlaceResult> {
  const results = await searchPlaces(query, 8);
  if (!results.length) throw new Error(`No indexed match found for “${query}”. Search a nearby landmark, add the area and PIN code, or choose the exact point using Pin on the map.`);
  return results[0];
}

function radians(value: number) { return (value * Math.PI) / 180; }
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const earthRadius = 6371000;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function countSupportPoints(route: [number, number][], places: SafePlace[], radiusMeters = 700): number {
  const stride = Math.max(1, Math.floor(route.length / 80));
  const samples = route.filter((_, index) => index % stride === 0);
  return places.filter((place) => samples.some(([lat, lon]) => distanceMeters(
    { lat, lon }, { lat: place.latitude, lon: place.longitude },
  ) <= radiusMeters)).length;
}

export function formatRouteItems(
  items: Array<{ coordinates: [number, number][]; distance: number; duration: number }>,
  places: SafePlace[],
): RouteOption[] {
  return items.slice(0, 3).map((item, index) => {
    const points: [number, number][] = item.coordinates.map(([lon, lat]) => [lat, lon]);
    return {
      distanceKm: item.distance / 1000,
      durationMin: item.duration / 60,
      coordinates: points,
      supportPointsNearby: countSupportPoints(points, places),
      label: index === 0 ? 'Best support-point coverage' : `Alternative ${index}`,
    };
  }).sort((a, b) => b.supportPointsNearby - a.supportPointsNearby);
}

export async function getDrivingRoutes(start: Coordinates, end: Coordinates, places: SafePlace[]): Promise<RouteOption[]> {
  const coordinates = `${start.lon},${start.lat};${end.lon},${end.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&alternatives=true&steps=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Routing service is unavailable. Try again in a moment.');
  const data = await response.json();
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes.length) throw new Error('No route found for those locations.');
  return formatRouteItems(data.routes.map((route: any) => ({ coordinates: route.geometry.coordinates as [number, number][], distance: route.distance, duration: route.duration })), places);
}

export function getCurrentPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not supported in this browser.'));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => reject(new Error(error.code === 1 ? 'Location permission was denied.' : 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    );
  });
}
