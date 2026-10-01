import { useEffect, useMemo, useState } from 'react';

// How often to look for new invites while the map is open. It also checks
// whenever the app comes back to the screen, which is when it matters most.
const REFRESH_MS = 3 * 60_000;

const EMPTY = { enabled: false, plannerEmail: '', visits: [], unplaced: [], error: '' };

/**
 * Site visits that reach the map by calendar invitation.
 *
 * A rep invites the planner's email address to a calendar event; the server
 * reads the planner's calendar and hands back the events this rep sent
 * (see api/invites.js). They are read fresh rather than saved, so a visit
 * moved or cancelled in the calendar moves or disappears here too — which
 * also means they are read-only on the map.
 *
 * Returns { enabled, plannerEmail, visits, unplaced, error }. `enabled` stays
 * false until the app's owner has connected a planner calendar.
 */
export function useInvitedVisits({ user, now }) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!user) {
      setState(EMPTY);
      return undefined;
    }
    let alive = true;
    let busy = false;

    async function load() {
      if (busy) return;
      busy = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/invites', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setState((s) => ({ ...s, error: data.error || "Couldn't read the planner calendar." }));
          return;
        }
        setState({
          enabled: Boolean(data.enabled),
          plannerEmail: data.plannerEmail || '',
          visits: Array.isArray(data.visits) ? data.visits : [],
          unplaced: Array.isArray(data.unplaced) ? data.unplaced : [],
          error: '',
        });
      } catch {
        // Offline for a moment: keep showing what was there, and say so.
        if (alive) setState((s) => ({ ...s, error: s.enabled ? "Couldn't reach the planner calendar." : '' }));
      } finally {
        busy = false;
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    const onReturn = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [user]);

  // Same rule as saved visits: once a visit has ended it leaves the map.
  const visits = useMemo(
    () => state.visits.filter((v) => Number(v.endTs) > now),
    [state.visits, now]
  );
  const unplaced = useMemo(
    () => state.unplaced.filter((v) => Number(v.endTs) > now),
    [state.unplaced, now]
  );

  return { ...state, visits, unplaced };
}
