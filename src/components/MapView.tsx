import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMapEvents } from 'react-leaflet';
import type { Coordinates, RouteOption, SafePlace } from '../lib/types';

type Props = {
  places: SafePlace[];
  route?: RouteOption | null;
  origin?: Coordinates | null;
  destination?: Coordinates | null;
  center?: Coordinates;
  height?: number;
  onMapClick?: (point: Coordinates) => void;
};

function MapClickHandler({ onMapClick }: { onMapClick?: (point: Coordinates) => void }) {
  const map = useMapEvents({ click(event) { onMapClick?.({ lat: event.latlng.lat, lon: event.latlng.lng }); } });
  useEffect(() => { if (onMapClick && map.getZoom() < 14) map.setZoom(14); }, [onMapClick, map]);
  return null;
}

function Recenter({ point }: { point?: Coordinates }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView([point.lat, point.lon], 13, { animate: true });
  }, [point?.lat, point?.lon, map]);
  return null;
}

function placeIcon(category: string) {
  const emoji = category.toLowerCase().includes('police') ? '👮' :
    category.toLowerCase().includes('hospital') || category.toLowerCase().includes('medical') ? '🏥' :
    category.toLowerCase().includes('pharmacy') ? '💊' : '🏠';
  return L.divIcon({
    className: 'safe-place-icon-wrap',
    html: `<div class="safe-place-pin">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export default function MapView({ places, route, origin, destination, center = { lat: 22.9734, lon: 78.6569 }, height = 420, onMapClick }: Props) {
  const focus = origin ?? destination ?? (places[0] ? { lat: places[0].latitude, lon: places[0].longitude } : center);
  return (
    <div className="map-shell" style={{ height }}>
      <MapContainer center={[focus.lat, focus.lon]} zoom={5} scrollWheelZoom className={`leaflet-map ${onMapClick ? 'map-picking' : ''}`}>
        <Recenter point={origin ?? destination ?? (places[0] ? { lat: places[0].latitude, lon: places[0].longitude } : undefined)} />
        <MapClickHandler onMapClick={onMapClick} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {places.map((place) => (
          <Marker key={place.id} position={[place.latitude, place.longitude]} icon={placeIcon(place.category)}>
            <Popup>
              <strong>{place.name}</strong><br />
              {place.category} · {place.address}<br />
              {place.phone ? `Phone: ${place.phone}` : 'Verified assistance point'}
            </Popup>
          </Marker>
        ))}
        {route && <Polyline positions={route.coordinates} pathOptions={{ color: '#1a9b70', weight: 6, opacity: 0.88 }} />}
        {origin && <CircleMarker center={[origin.lat, origin.lon]} radius={8} pathOptions={{ color: '#0b6b4c', fillColor: '#39cf98', fillOpacity: 1 }}><Popup>Journey start</Popup></CircleMarker>}
        {destination && <CircleMarker center={[destination.lat, destination.lon]} radius={8} pathOptions={{ color: '#8a2b2b', fillColor: '#f06b6b', fillOpacity: 1 }}><Popup>Destination</Popup></CircleMarker>}
      </MapContainer>
      <div className="map-attribution-note">Map data © OpenStreetMap contributors</div>
    </div>
  );
}
