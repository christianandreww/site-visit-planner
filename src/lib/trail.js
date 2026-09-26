// One card shows at a time, but you can walk from a visit to a neighbouring
// visit to one of your pins and back again. Keeping that route as a trail
// rather than a single selection is what makes a Back button possible: the
// last entry is the card on screen, everything before it is the way back.

/** The prospect — the client being scheduled — is not saved, so it has no id. */
export const PROSPECT = 'PROSPECT';

// Nobody navigates twelve cards back. The cap only stops the array growing
// without limit over a long session.
export const MAX_TRAIL = 12;

export const visitStop = (id) => ({ kind: 'visit', id });
export const placeStop = (id) => ({ kind: 'place', id });

/**
 * The trail with anything that has vanished behind you removed.
 *
 * Visits do not last: one can be deleted from its own card, and every visit
 * eventually ends and drops off the map on the minute tick — possibly while
 * it is sitting two steps back in the trail. Filtering on read rather than
 * pruning on every change keeps that from needing an effect that races the
 * live Firestore subscription.
 */
export function liveStops(trail, { visits = [], places = [], hasProspect = false } = {}) {
  return trail.filter((stop) => {
    if (stop.kind === 'place') return places.some((p) => p.id === stop.id);
    if (stop.id === PROSPECT) return hasProspect;
    return visits.some((v) => v.id === stop.id);
  });
}

/**
 * Start again from one card: what tapping a map pin or a search result does.
 * A fresh trail is the point — otherwise Back would march you through every
 * pin you had ever glanced at, which is not a history anyone wants.
 */
export const startTrail = (stop) => [stop];

/** Step deeper: opening something from inside a card. */
export const pushStop = (trail, stop) => [...trail, stop].slice(-MAX_TRAIL);

/** Step back one card. */
export const popStop = (trail) => trail.slice(0, -1);
