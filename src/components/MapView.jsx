import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { pinLabel, todayISO, urgencyTier } from '../lib/time.js';
import { colorHex, placeColor, placeInitial } from '../lib/places.js';

const SG_CENTER = [1.3521, 103.8198];

// Where two pins overlap, the sooner visit stays on top.
const TIER_Z = { urgent: 200, soon: 100, later: 0 };

export default function MapView({
  visits,
  places = [],
  currentClient,
  selectedId,
  selectedPlaceId,
  onSelect,
  onSelectPlace,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const didFitRef = useRef(false);
  const prevClientRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectPlaceRef = useRef(onSelectPlace);
  onSelectPlaceRef.current = onSelectPlace;

  // ── create the map once ─────────────────────────────────────────────────
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: SG_CENTER,
      zoom: 12,
      zoomControl: false,
      maxBounds: [
        [1.09, 103.49],
        [1.55, 104.2],
      ],
      maxBoundsViscosity: 0.8,
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      attribution:
        '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noreferrer">OneMap</a> © contributors | © <a href="https://www.sla.gov.sg/" target="_blank" rel="noreferrer">Singapore Land Authority</a>',
      maxZoom: 19,
      minZoom: 11,
    }).addTo(map);
    map.on('click', () => {
      onSelectRef.current(null);
      onSelectPlaceRef.current(null);
    });
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // ── (re)draw pins whenever data or selection changes ────────────────────
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    // Custom pins are background furniture: drawn first, and kept beneath the
    // scheduled visits when they overlap.
    for (const p of places) {
      const sel = p.id === selectedPlaceId ? ' pin-selected' : '';
      const hex = colorHex(placeColor(p));
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: `<div class="pin pin-place${sel}" style="background:${hex}"><span>${placeInitial(p)}</span></div>`,
        iconSize: [34, 42],
        iconAnchor: [17, 41],
      });
      L.marker([p.lat, p.lng], { icon, zIndexOffset: sel ? 500 : -200 })
        .on('click', () => onSelectPlaceRef.current(p.id))
        .addTo(layer);
    }

    // visits arrive sorted by end time, so the index IS the running order
    const today = todayISO();
    visits.forEach((v, i) => {
      const sel = v.id === selectedId ? ' pin-selected' : '';
      const label = pinLabel(v.date, today);
      const long = label.length > 3 ? ' pin-long' : '';
      const cal = v.fromCalendar ? ' pin-cal' : '';
      const tier = urgencyTier(v.date, today);
      const icon = L.divIcon({
        className: 'pin-wrap',
        html:
          `<div class="pin pin-visit pin-${tier}${sel}${long}${cal}"><span>${label}</span>` +
          `<b class="pin-seq">${i + 1}</b></div>`,
        iconSize: [40, 48],
        iconAnchor: [20, 47],
      });
      L.marker([v.lat, v.lng], { icon, zIndexOffset: sel ? 900 : TIER_Z[tier] })
        .on('click', () => onSelectRef.current(v.id))
        .addTo(layer);
    });

    if (currentClient) {
      const sel = selectedId === 'PROSPECT' ? ' pin-selected' : '';
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: `<div class="pin pin-new${sel}"><span>NEW</span></div>`,
        iconSize: [40, 48],
        iconAnchor: [20, 47],
      });
      L.marker([currentClient.lat, currentClient.lng], { icon, zIndexOffset: 1000 })
        .on('click', () => onSelectRef.current('PROSPECT'))
        .addTo(layer);
    }
  }, [visits, places, currentClient, selectedId, selectedPlaceId]);

  // ── fit all pins into view on first load ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || didFitRef.current) return;
    const pts = [
      ...visits.map((v) => [v.lat, v.lng]),
      ...places.map((p) => [p.lat, p.lng]),
      ...(currentClient ? [[currentClient.lat, currentClient.lng]] : []),
    ];
    if (pts.length === 0) return;
    didFitRef.current = true;
    if (pts.length === 1) map.setView(pts[0], 14);
    else map.fitBounds(L.latLngBounds(pts), { padding: [70, 70] });
  }, [visits, places, currentClient]);

  // ── bring an off-screen pin into view when picked from search ───────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const picked =
      selectedId && selectedId !== 'PROSPECT'
        ? visits.find((x) => x.id === selectedId)
        : selectedPlaceId
          ? places.find((x) => x.id === selectedPlaceId)
          : null;
    if (!picked) return;
    const target = L.latLng(picked.lat, picked.lng);
    if (!map.getBounds().pad(-0.15).contains(target)) {
      map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.7 });
    }
  }, [selectedId, selectedPlaceId, visits, places]);

  // ── glide to a newly entered client ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const prev = prevClientRef.current;
    prevClientRef.current = currentClient;
    if (!map || !currentClient) return;
    if (prev && prev.lat === currentClient.lat && prev.lng === currentClient.lng) return;
    map.flyTo(
      [currentClient.lat, currentClient.lng],
      Math.max(map.getZoom(), 13),
      { duration: 0.8 }
    );
  }, [currentClient]);

  return <div className="map" ref={containerRef} />;
}
