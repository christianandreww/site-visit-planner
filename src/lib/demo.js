import { todayISO, endTimestamp } from './time.js';

// Demo mode gives you a feel for the app before Firebase/OneMap are set up
// (it also runs automatically whenever Firebase isn't configured yet).
// Nothing here is saved anywhere.

function visit(id, name, address, postal, lat, lng, dayOffset, start, end) {
  const date = todayISO(dayOffset);
  return {
    id,
    name,
    address,
    postal,
    lat,
    lng,
    date,
    start,
    end,
    endTs: endTimestamp(date, end),
  };
}

export function sampleVisits() {
  return [
    visit('demo-1', 'Marcus Tan', '12 Woodlands Crescent', '737916', 1.4443, 103.802, 1, '10:00', '11:00'),
    visit('demo-2', 'John Tan', '3 Elias Road', '519931', 1.3736, 103.944, 1, '14:00', '15:00'),
    visit('demo-3', 'Sarah Lim', '88 Bedok North Avenue 4', '489948', 1.33, 103.927, 2, '14:00', '15:00'),
    visit('demo-4', 'Priya Nair', '7 Jurong West Street 52', '649296', 1.3496, 103.719, 2, '10:00', '11:00'),
    visit('demo-5', 'David Chua', '15 Binjai Park', '589827', 1.3376, 103.7765, 3, '15:00', '16:00'),
  ];
}

// Permanent custom pins: fixed places that never expire.
export function samplePlaces() {
  return [
    { id: 'demo-place-1', name: 'Home', address: '30 Jalan Kembangan', postal: '419166', lat: 1.3223, lng: 103.9105, color: 'green' },
    { id: 'demo-place-2', name: 'Office', address: '10 Anson Road', postal: '079903', lat: 1.2749, lng: 103.8452, color: 'teal' },
    { id: 'demo-place-3', name: 'School', address: '21 Anderson Road', postal: '259983', lat: 1.3196, lng: 103.8243, color: 'violet' },
  ];
}

// A prospect mid-call, matching the brief's example: new client at 5 Elias Road —
// the map instantly shows they're right next to John Tan's visit tomorrow.
export function sampleProspect() {
  return {
    name: 'Daniel Ng',
    address: '5 Elias Road',
    postal: '519932',
    lat: 1.3745,
    lng: 103.9448,
  };
}
