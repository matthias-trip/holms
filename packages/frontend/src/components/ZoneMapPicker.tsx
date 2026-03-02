import { useEffect, useRef, useCallback, useState } from "react";
import { Search } from "lucide-react";
import type { LocationZone } from "@holms/shared";
import { useTheme } from "../context/ThemeContext";

const DEFAULT_CENTER: [number, number] = [52.37, 4.9]; // Amsterdam

// MapKit JS type shims (global `mapkit` namespace loaded via CDN script)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace mapkit {
    function init(options: {
      authorizationCallback: (done: (token: string) => void) => void;
    }): void;

    class Coordinate {
      constructor(latitude: number, longitude: number);
      latitude: number;
      longitude: number;
    }
    class CoordinateSpan {
      constructor(latDelta: number, lngDelta: number);
    }
    class CoordinateRegion {
      constructor(center: Coordinate, span: CoordinateSpan);
    }

    class Map {
      constructor(container: HTMLElement | string, options?: Record<string, unknown>);
      colorScheme: string;
      center: Coordinate;
      region: CoordinateRegion;
      annotations: Annotation[];
      overlays: Overlay[];
      addAnnotation(a: Annotation): void;
      addAnnotations(a: Annotation[]): void;
      removeAnnotation(a: Annotation): void;
      removeAnnotations(a: Annotation[]): void;
      addOverlay(o: Overlay): void;
      addOverlays(o: Overlay[]): void;
      removeOverlay(o: Overlay): void;
      removeOverlays(o: Overlay[]): void;
      setCenterAnimated(coord: Coordinate, animate?: boolean): void;
      setRegionAnimated(region: CoordinateRegion, animate?: boolean): void;
      addEventListener(type: string, handler: (e: any) => void): void;
      removeEventListener(type: string, handler: (e: any) => void): void;
      destroy(): void;
    }

    class MarkerAnnotation {
      constructor(coordinate: Coordinate, options?: Record<string, unknown>);
      coordinate: Coordinate;
      title: string;
      draggable: boolean;
      selected: boolean;
      color: string;
      glyphText: string;
      addEventListener(type: string, handler: (e: any) => void): void;
    }

    class CircleOverlay {
      constructor(coordinate: Coordinate, radius: number, options?: Record<string, unknown>);
      coordinate: Coordinate;
      radius: number;
      style: Style;
    }

    class Style {
      constructor(options?: Record<string, unknown>);
      strokeColor: string;
      fillColor: string;
      lineWidth: number;
      strokeOpacity: number;
      fillOpacity: number;
    }

    type Annotation = MarkerAnnotation;
    type Overlay = CircleOverlay;

    class Search {
      constructor(options?: { region?: CoordinateRegion });
      autocomplete(
        query: string,
        callback: (error: Error | null, response: { results: SearchAutocompleteResult[] }) => void,
        options?: { coordinate?: Coordinate },
      ): void;
    }

    interface SearchAutocompleteResult {
      displayLines: string[];
      coordinate: Coordinate;
    }

    namespace Map {
      const ColorSchemes: {
        Light: string;
        Dark: string;
      };
    }
  }
}

// Singleton: loads the MapKit JS SDK + fetches token from daemon
let mapkitReady: Promise<void> | null = null;

async function fetchMapKitToken(): Promise<string> {
  const res = await fetch("/api/mapkit-token");
  if (!res.ok) throw new Error(`MapKit token request failed (${res.status})`);
  const data = await res.json();
  return data.token;
}

function ensureMapKit(): Promise<void> {
  if (mapkitReady) return mapkitReady;

  mapkitReady = (async () => {
    // Load SDK script if not already present
    if (typeof mapkit === "undefined" || !mapkit.init) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
        script.crossOrigin = "anonymous";
        script.async = true;
        script.dataset.libraries = "map,annotations,overlays,services";
        script.dataset.callback = "__holmsMapKitInit";

        (window as any).__holmsMapKitInit = () => {
          delete (window as any).__holmsMapKitInit;
          resolve();
        };

        script.onerror = () => {
          mapkitReady = null;
          reject(new Error("Failed to load MapKit JS"));
        };

        document.head.appendChild(script);
      });
    }

    // Fetch token from daemon and init
    const token = await fetchMapKitToken();
    mapkit.init({
      authorizationCallback: (done) => done(token),
    });
  })();

  // Allow retry on failure
  mapkitReady.catch(() => { mapkitReady = null; });

  return mapkitReady;
}

interface ZoneMapPickerProps {
  center?: [number, number];
  radius?: number;
  zones?: LocationZone[];
  selectedZoneId?: string | null;
  onChange: (lat: number, lng: number, radius: number) => void;
  onSearchSelect?: (name: string) => void;
  interactive?: boolean;
}

export default function ZoneMapPicker({
  center,
  radius = 100,
  zones = [],
  selectedZoneId,
  onChange,
  onSearchSelect,
  interactive = true,
}: ZoneMapPickerProps) {
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapkit.Map | null>(null);
  const markerRef = useRef<mapkit.MarkerAnnotation | null>(null);
  const circleRef = useRef<mapkit.CircleOverlay | null>(null);
  const bgOverlaysRef = useRef<mapkit.CircleOverlay[]>([]);
  const bgAnnotationsRef = useRef<mapkit.MarkerAnnotation[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSearchSelectRef = useRef(onSearchSelect);
  onSearchSelectRef.current = onSearchSelect;
  const searchRef = useRef<mapkit.Search | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<mapkit.SearchAutocompleteResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    ensureMapKit().then(() => {
      if (destroyed || !containerRef.current) return;

      const initialCenter = center
        ?? (zones.length > 0
          ? [zones[0].latitude, zones[0].longitude] as [number, number]
          : DEFAULT_CENTER);

      const map = new mapkit.Map(containerRef.current!, {
        center: new mapkit.Coordinate(initialCenter[0], initialCenter[1]),
        region: new mapkit.CoordinateRegion(
          new mapkit.Coordinate(initialCenter[0], initialCenter[1]),
          new mapkit.CoordinateSpan(0.02, 0.02),
        ),
        colorScheme: resolved === "dark" ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light,
        showsCompass: 1, // FeatureVisibility.Adaptive
        showsZoomControl: true,
        showsMapTypeControl: false,
        isScrollEnabled: true,
        isZoomEnabled: true,
      });

      mapRef.current = map;
      setLoading(false);
    }).catch((err) => {
      if (!destroyed) {
        setError(String(err));
        setLoading(false);
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
      markerRef.current = null;
      circleRef.current = null;
      bgOverlaysRef.current = [];
      bgAnnotationsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Color scheme
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.colorScheme = resolved === "dark" ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light;
  }, [resolved]);

  // Background zones (non-interactive)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old background layers
    if (bgOverlaysRef.current.length) map.removeOverlays(bgOverlaysRef.current);
    if (bgAnnotationsRef.current.length) map.removeAnnotations(bgAnnotationsRef.current);
    bgOverlaysRef.current = [];
    bgAnnotationsRef.current = [];

    for (const z of zones) {
      if (z.id === selectedZoneId) continue;

      const overlay = new mapkit.CircleOverlay(
        new mapkit.Coordinate(z.latitude, z.longitude),
        z.radiusMeters,
        {
          style: new mapkit.Style({
            strokeColor: "#8888",
            fillColor: "#8884",
            lineWidth: 1,
            strokeOpacity: 0.5,
            fillOpacity: 0.12,
          }),
        },
      );
      bgOverlaysRef.current.push(overlay);

      const label = new mapkit.MarkerAnnotation(
        new mapkit.Coordinate(z.latitude, z.longitude),
        {
          title: z.name,
          draggable: false,
          color: "#888",
          glyphText: "",
        },
      );
      bgAnnotationsRef.current.push(label);
    }

    if (bgOverlaysRef.current.length) map.addOverlays(bgOverlaysRef.current);
    if (bgAnnotationsRef.current.length) map.addAnnotations(bgAnnotationsRef.current);
  }, [zones, selectedZoneId]);

  // Active marker + circle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!center) {
      // Remove active marker/circle
      if (markerRef.current) { map.removeAnnotation(markerRef.current); markerRef.current = null; }
      if (circleRef.current) { map.removeOverlay(circleRef.current); circleRef.current = null; }
      return;
    }

    const coord = new mapkit.Coordinate(center[0], center[1]);

    // Marker
    if (!markerRef.current) {
      const marker = new mapkit.MarkerAnnotation(coord, {
        draggable: interactive,
        selected: true,
        title: "",
        color: "#3b82f6",
      });
      if (interactive) {
        marker.addEventListener("drag-end", () => {
          const c = marker.coordinate;
          const r = circleRef.current?.radius ?? radius;
          onChangeRef.current(c.latitude, c.longitude, r);
        });
      }
      map.addAnnotation(marker);
      markerRef.current = marker;
    } else {
      markerRef.current.coordinate = coord;
    }

    // Circle
    if (!circleRef.current) {
      const circle = new mapkit.CircleOverlay(coord, radius, {
        style: new mapkit.Style({
          strokeColor: "#3b82f6",
          fillColor: "#3b82f6",
          lineWidth: 2,
          strokeOpacity: 0.8,
          fillOpacity: 0.12,
        }),
      });
      map.addOverlay(circle);
      circleRef.current = circle;
    } else {
      circleRef.current.coordinate = coord;
      circleRef.current.radius = radius;
    }
  }, [center, radius, interactive]);

  // Pan to selected zone
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedZoneId) return;
    const zone = zones.find((z) => z.id === selectedZoneId);
    if (zone) {
      map.setRegionAnimated(
        new mapkit.CoordinateRegion(
          new mapkit.Coordinate(zone.latitude, zone.longitude),
          new mapkit.CoordinateSpan(0.01, 0.01),
        ),
        true,
      );
    }
  }, [selectedZoneId, zones]);

  // Click to place
  const handleClick = useCallback(
    (e: any) => {
      if (!interactive) return;
      // MapKit JS single-tap event includes a coordinate on the pointOnPage
      // The event from "single-tap" has a coordinate property
      if (e.coordinate) {
        onChangeRef.current(e.coordinate.latitude, e.coordinate.longitude, radius);
      }
    },
    [interactive, radius],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.addEventListener("single-tap", handleClick);
    return () => { map.removeEventListener("single-tap", handleClick); };
  }, [handleClick]);

  // Search autocomplete
  const handleSearchInput = useCallback((query: string) => {
    setSearchQuery(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      if (!searchRef.current) {
        searchRef.current = new mapkit.Search();
      }
      const opts = mapRef.current ? { coordinate: mapRef.current.center } : undefined;
      searchRef.current.autocomplete(query, (err, response) => {
        if (err || !response?.results) {
          setSearchResults([]);
          return;
        }
        setSearchResults(response.results);
        setSearchOpen(true);
      }, opts);
    }, 300);
  }, []);

  const handleResultSelect = useCallback((result: mapkit.SearchAutocompleteResult) => {
    const { latitude, longitude } = result.coordinate;
    onChangeRef.current(latitude, longitude, radius);

    if (mapRef.current) {
      mapRef.current.setRegionAnimated(
        new mapkit.CoordinateRegion(
          new mapkit.Coordinate(latitude, longitude),
          new mapkit.CoordinateSpan(0.01, 0.01),
        ),
        true,
      );
    }

    setSearchQuery("");
    setSearchResults([]);
    setSearchOpen(false);

    if (onSearchSelectRef.current && result.displayLines[0]) {
      onSearchSelectRef.current(result.displayLines[0]);
    }
  }, [radius]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (error) {
    return (
      <div
        className="rounded-lg flex items-center justify-center"
        style={{
          height: 360,
          border: "1px solid var(--gray-a5)",
          background: "var(--gray-1)",
        }}
      >
        <div className="text-center px-6">
          <div className="text-xs font-medium mb-2" style={{ color: "var(--danger)" }}>
            Map unavailable
          </div>
          <div className="text-[11px]" style={{ color: "var(--gray-8)" }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden"
        style={{
          height: 360,
          border: "1px solid var(--gray-a5)",
          cursor: interactive ? "crosshair" : undefined,
        }}
      />
      {loading && (
        <div
          className="absolute inset-0 rounded-lg flex items-center justify-center"
          style={{ background: "var(--gray-2)" }}
        >
          <div className="text-[11px]" style={{ color: "var(--gray-8)" }}>Loading map...</div>
        </div>
      )}
      {interactive && !loading && !error && (
        <div
          ref={searchContainerRef}
          className="absolute top-3 right-3"
          style={{ width: 260, zIndex: 10 }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{
              background: "var(--gray-1)",
              border: "1px solid var(--gray-a5)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          >
            <Search size={14} style={{ color: "var(--gray-8)", flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="Search address..."
              className="flex-1 text-xs bg-transparent outline-none"
              style={{ color: "var(--gray-12)" }}
              onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setSearchQuery("");
                  setSearchResults([]);
                }
              }}
            />
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div
              className="mt-1 rounded-lg overflow-hidden"
              style={{
                background: "var(--gray-1)",
                border: "1px solid var(--gray-a5)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              {searchResults.map((result, i) => (
                <button
                  key={i}
                  className="w-full text-left px-3 py-2 transition-colors duration-100 cursor-pointer"
                  style={{ borderBottom: i < searchResults.length - 1 ? "1px solid var(--gray-a3)" : undefined }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  onClick={() => handleResultSelect(result)}
                >
                  <div className="text-xs truncate" style={{ color: "var(--gray-12)" }}>
                    {result.displayLines[0]}
                  </div>
                  {result.displayLines[1] && (
                    <div className="text-[10px] truncate mt-0.5" style={{ color: "var(--gray-8)" }}>
                      {result.displayLines[1]}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
