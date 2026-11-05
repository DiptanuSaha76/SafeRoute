export type Coordinates = { lat: number; lon: number };

export type SafePlace = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  opening_hours: string | null;
  status: 'pending' | 'verified' | 'rejected';
  verification_note?: string | null;
};

export type Helpline = {
  id: string;
  country: string;
  state: string | null;
  city: string | null;
  name: string;
  category: string;
  number: string;
  description: string | null;
  is_toll_free: boolean;
  availability: string | null;
  official_url: string | null;
  is_active: boolean;
  verified_at: string | null;
};

export type RouteOption = {
  distanceKm: number;
  durationMin: number;
  coordinates: [number, number][];
  supportPointsNearby: number;
  label: string;
};

export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  role: 'user' | 'admin';
  public_key_jwk: JsonWebKey | null;
};

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
