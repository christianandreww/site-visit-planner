import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, parseIcsTime, sgDateTime } from '../api/_lib/ics.js';

// Shaped like Google Calendar's private iCal feed: CRLF line endings, UTC
// times, a folded long line, escaped text, and a reminder nested inside.
const GOOGLE_FEED = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'X-WR-TIMEZONE:Asia/Singapore',
  'BEGIN:VEVENT',
  'DTSTART:20261009T060000Z',
  'DTEND:20261009T070000Z',
  'UID:abc123@google.com',
  'ORGANIZER;CN=Jason Lim:mailto:Jason@GetSolar.example',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Tan, Mr: owner";X-NUM-GUESTS=0:mailto:tan.owner@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION:mailto:planner@getsolar.example',
  'SUMMARY:Site visit – Mr Tan',
  'LOCATION:Blk 123 Serangoon Ave 3\\, #05-12\\, Singapore 550123',
  'DESCRIPTION:Roof is flat.\\nBring the drone\\; client prefers WhatsApp. This line is long enough',
  '  that Google folded it onto a second line.',
  'STATUS:CONFIRMED',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H30M0S',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

test('reads an event the way Google exports it', () => {
  const [e] = parseIcs(GOOGLE_FEED);
  assert.equal(e.uid, 'abc123@google.com');
  assert.equal(e.summary, 'Site visit – Mr Tan');
  assert.equal(e.location, 'Blk 123 Serangoon Ave 3, #05-12, Singapore 550123', 'escaped commas undone');
  assert.equal(e.organizer, 'jason@getsolar.example', 'organizer, lower-cased');
  assert.deepEqual(e.attendees, ['tan.owner@example.com', 'planner@getsolar.example'],
    'a quoted name containing a colon does not break the address');
  assert.equal(e.status, 'CONFIRMED');
  assert.equal(sgDateTime(e.start.epochMs).time, '14:00', '06:00 UTC is 2pm in Singapore');
  assert.equal(sgDateTime(e.end.epochMs).time, '15:00');
});

test('a folded line is joined back together, and a reminder cannot overwrite it', () => {
  const [e] = parseIcs(GOOGLE_FEED);
  assert.match(e.description, /This line is long enough that Google folded it/);
  assert.match(e.description, /^Roof is flat\.\nBring the drone; client/);
  assert.doesNotMatch(e.description, /event reminder/, "the VALARM's DESCRIPTION is ignored");
});

test('times in a named zone, floating times and all-day dates', () => {
  const sg = parseIcsTime('20261009T140000', { TZID: 'Asia/Singapore' });
  assert.deepEqual(sgDateTime(sg.epochMs), { date: '2026-10-09', time: '14:00' });

  const floating = parseIcsTime('20261009T140000');
  assert.equal(floating.epochMs, sg.epochMs, 'no zone given → read as Singapore time');

  // New York is on daylight time (UTC-4) on 9 Oct: 2am there is 2pm here.
  const ny = parseIcsTime('20261009T020000', { TZID: 'America/New_York' });
  assert.deepEqual(sgDateTime(ny.epochMs), { date: '2026-10-09', time: '14:00' });

  const windows = parseIcsTime('20261009T140000', { TZID: 'Singapore Standard Time' });
  assert.equal(windows.epochMs, sg.epochMs, 'an unrecognised zone name falls back to Singapore');

  const allDay = parseIcsTime('20261009', { VALUE: 'DATE' });
  assert.equal(allDay.allDay, true);
  assert.deepEqual(sgDateTime(allDay.epochMs), { date: '2026-10-09', time: '00:00' });
});

test('a late-evening UTC time lands on the next Singapore day', () => {
  const t = parseIcsTime('20261009T163000Z');
  assert.deepEqual(sgDateTime(t.epochMs), { date: '2026-10-10', time: '00:30' });
});

test('cancelled and recurring events are recognisable', () => {
  const feed = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:gone',
    'DTSTART:20261009T060000Z',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:weekly',
    'DTSTART;TZID=Asia/Singapore:20261012T090000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:no-start',
    'SUMMARY:Broken event with no start time',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  const events = parseIcs(feed);
  assert.equal(events.length, 2, 'an event without a start time is dropped');
  assert.equal(events[0].status, 'CANCELLED');
  assert.equal(events[1].recurring, true);
});
