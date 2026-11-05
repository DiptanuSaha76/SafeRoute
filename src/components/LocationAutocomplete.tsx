import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MapPin, Search, Sparkles } from 'lucide-react';
import { searchPlaces, type PlaceResult } from '../lib/geo';

type Props = {
  value: string;
  placeholder: string;
  marker: 'start' | 'end';
  onTextChange: (value: string) => void;
  onSelect: (place: PlaceResult) => void;
  onPickOnMap: () => void;
  disabled?: boolean;
};

export default function LocationAutocomplete({ value, placeholder, marker, onTextChange, onSelect, onPickOnMap, disabled }: Props) {
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setResults([]); setOpen(false); setSearched(false); setError('');
      return;
    }
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const places = await searchPlaces(query, 10);
        if (requestId.current === id) {
          setResults(places); setSearched(true); setOpen(true);
        }
      } catch (cause) {
        if (requestId.current === id) {
          setResults([]); setSearched(true); setOpen(true);
          setError(cause instanceof Error ? cause.message : 'Location search is temporarily unavailable.');
        }
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function choose(place: PlaceResult) {
    onSelect(place);
    setOpen(false);
    setResults([]);
  }

  return (
    <div className="location-autocomplete" ref={root}>
      <div className="input-with-icon">
        <span className={`location-dot ${marker === 'start' ? 'start-dot' : 'end-dot'}`} />
        <input
          value={value}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => { if (results.length || searched) setOpen(true); }}
          onChange={(event) => { onTextChange(event.target.value); setSearched(false); setError(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'Enter' && open && results[0]) { event.preventDefault(); choose(results[0]); }
          }}
          placeholder={placeholder}
        />
        {loading ? <LoaderCircle size={15} className="location-search-spinner"/> : <button type="button" className="location-map-pick" onClick={onPickOnMap} title="Choose an exact point on the map"><MapPin size={14}/> Pin</button>}
      </div>
      {open && (
        <div className="location-suggestions" role="listbox">
          {results.length ? <>
            {results.map((place, index) => (
              <button type="button" className="location-suggestion" key={`${place.lat}-${place.lon}-${index}`} onClick={() => choose(place)}>
                <span className="suggestion-icon"><MapPin size={15}/></span>
                <span className="suggestion-copy"><strong>{place.name}</strong><small>{place.label}</small></span>
                <span className="suggestion-source">{place.source}</span>
              </button>
            ))}
            <div className="location-search-footer"><Sparkles size={13}/> Results from location search providers. Verify the selected pin before starting.</div>
          </> : searched && !loading ? <div className="location-no-results">
            <Search size={15}/>
            <span>{error || 'No indexed place matched this exact name. Try adding the locality, district, state and PIN code, or choose the exact spot with Pin on the map.'}<br/><strong>Tip:</strong> Small buildings and private landmarks may not exist in map databases.</span>
          </div> : null}
        </div>
      )}
    </div>
  );
}
