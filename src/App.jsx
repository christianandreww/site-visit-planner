import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, getRedirectResult, signOut } from 'firebase/auth';
import { auth, firebaseReady } from './firebase.js';
import { useVisits } from './hooks/useVisits.js';
import { useInvitedVisits } from './hooks/useInvitedVisits.js';
import { usePlaces } from './hooks/usePlaces.js';
import { sampleProspect } from './lib/demo.js';
import {
  PROSPECT,
  liveStops,
  placeStop,
  popStop,
  pushStop,
  startTrail,
  visitStop,
} from './lib/trail.js';
import MapView from './components/MapView.jsx';
import MapLegend from './components/MapLegend.jsx';
import NewClientBar from './components/NewClientBar.jsx';
import VisitForm from './components/VisitForm.jsx';
import VisitPopup from './components/VisitPopup.jsx';
import PlaceForm from './components/PlaceForm.jsx';
import PlaceCard from './components/PlaceCard.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import SignIn from './components/SignIn.jsx';
import CalendarNotice from './components/CalendarNotice.jsx';

const CLOSED_VISIT_FORM = { open: false, prefill: null, fromProspect: false, editId: null };
const CLOSED_PLACE_FORM = { open: false, prefill: null, editId: null };

export default function App() {
  // Demo mode: automatic while Firebase isn't configured, or force with ?demo=1
  const demo = useMemo(
    () => !firebaseReady || new URLSearchParams(window.location.search).has('demo'),
    []
  );

  // ── auth ────────────────────────────────────────────────────────────────
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    if (demo) return undefined;
    getRedirectResult(auth).catch((e) => setAuthError(e.message || 'Sign-in failed.'));
    return onAuthStateChanged(auth, (u) => setUser(u ?? null));
  }, [demo]);

  // ── clock tick: re-check every minute which visits are still upcoming ───
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── data ────────────────────────────────────────────────────────────────
  const activeUser = demo ? null : user;
  const {
    visits: savedVisits,
    loading,
    error,
    addVisit,
    updateVisit,
    removeVisit,
  } = useVisits({ demo, user: activeUser, now });

  // Visits that arrive by inviting the planner's email to a calendar event.
  // They join the saved ones everywhere — map, running order, nearby lists,
  // clash warnings, search — but stay read-only, since the calendar owns them.
  const invited = useInvitedVisits({ user: activeUser, now });
  const visits = useMemo(
    () => [...savedVisits, ...invited.visits].sort((a, b) => a.endTs - b.endTs),
    [savedVisits, invited.visits]
  );
  // Custom pins are permanent: no clock, no expiry.
  const { places, placesError, addPlace, updatePlace, removePlace } = usePlaces({
    demo,
    user: activeUser,
  });

  // ── the client currently being scheduled (highlighted orange pin) ───────
  const [currentClient, setCurrentClient] = useState(() =>
    demo ? sampleProspect() : null
  );

  // ── where you are, and how you got here (see lib/trail.js) ──────────────
  // Tapping a map pin or a search result starts a fresh trail: that is a new
  // train of thought, not a step deeper.
  const [trail, setTrail] = useState(() => (demo ? [visitStop(PROSPECT)] : []));
  const liveTrail = useMemo(
    () => liveStops(trail, { visits, places, hasProspect: Boolean(currentClient) }),
    [trail, visits, places, currentClient]
  );

  const here = liveTrail[liveTrail.length - 1] || null;
  const selectedId = here && here.kind === 'visit' ? here.id : null;
  const selectedPlaceId = here && here.kind === 'place' ? here.id : null;
  const canGoBack = liveTrail.length > 1;

  const selectVisit = (id) => setTrail(startTrail(visitStop(id)));
  const selectPlace = (id) => setTrail(startTrail(placeStop(id)));
  const openFromCard = (stop) => setTrail(pushStop(liveTrail, stop));
  const goBack = useCallback(
    () =>
      setTrail((t) =>
        popStop(liveStops(t, { visits, places, hasProspect: Boolean(currentClient) }))
      ),
    [visits, places, currentClient]
  );
  const closeCard = () => setTrail([]);

  const [visitForm, setVisitForm] = useState(CLOSED_VISIT_FORM);
  const [placeForm, setPlaceForm] = useState(CLOSED_PLACE_FORM);
  const [searchOpen, setSearchOpen] = useState(false);

  // A card opened from inside a form sits on top of it: consult-only, and
  // Back or Close returns you to the half-filled form exactly as you left it.
  const peeking = (visitForm.open || placeForm.open) && liveTrail.length > 0;

  const selectedVisit =
    selectedId && selectedId !== PROSPECT
      ? visits.find((v) => v.id === selectedId) || null
      : null;
  const selectedPlace = selectedPlaceId
    ? places.find((p) => p.id === selectedPlaceId) || null
    : null;

  function handleSetClient(client) {
    setCurrentClient(client);
    selectVisit(PROSPECT);
  }

  function handleClearClient() {
    setCurrentClient(null); // the trail drops the prospect on its own
  }

  // ── visits ──────────────────────────────────────────────────────────────
  async function handleSaveVisit(data) {
    const id = visitForm.editId
      ? await updateVisit(visitForm.editId, data)
      : await addVisit(data);
    if (visitForm.fromProspect) setCurrentClient(null);
    setVisitForm(CLOSED_VISIT_FORM);
    selectVisit(id);
  }

  async function handleRemoveVisit(id) {
    await removeVisit(id);
  }

  // ── custom pins ─────────────────────────────────────────────────────────
  async function handleSavePlace(data) {
    const id = placeForm.editId
      ? await updatePlace(placeForm.editId, data)
      : await addPlace(data);
    setPlaceForm(CLOSED_PLACE_FORM);
    selectPlace(id);
  }

  async function handleRemovePlace(id) {
    await removePlace(id);
  }

  // Escape retraces the same path the Back button does, then closes search.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (liveTrail.length) goBack();
      else setSearchOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [liveTrail.length, goBack]);

  if (!demo && user === undefined) {
    return <div className="splash">Loading…</div>;
  }
  if (!demo && user === null) {
    return <SignIn error={authError} />;
  }

  return (
    <div className="app">
      <MapView
        visits={visits}
        places={places}
        currentClient={currentClient}
        selectedId={selectedId}
        selectedPlaceId={selectedPlaceId}
        onSelect={selectVisit}
        onSelectPlace={selectPlace}
      />

      <NewClientBar
        currentClient={currentClient}
        onSetClient={handleSetClient}
        onClearClient={handleClearClient}
        onSaveClient={() =>
          setVisitForm({
            open: true,
            prefill: currentClient,
            fromProspect: true,
            editId: null,
          })
        }
      />

      {demo && (
        <div className="banner banner-demo">
          Demo data — nothing is saved. See the README to go live.
        </div>
      )}
      {(error || placesError) && (
        <div className="banner banner-error">{error || placesError}</div>
      )}
      {!demo && loading && <div className="banner banner-muted">Loading your visits…</div>}
      {!error && !placesError && !loading && (
        <CalendarNotice error={invited.error} unplaced={invited.unplaced} />
      )}

      <MapLegend places={places} hasVisits={visits.length > 0} />

      <button
        className="fab"
        onClick={() => setVisitForm({ ...CLOSED_VISIT_FORM, open: true })}
      >
        + Add Site Visit
      </button>

      <button
        className="fab-small"
        aria-label="Add a custom pin"
        title="Add a custom pin"
        onClick={() => setPlaceForm({ ...CLOSED_PLACE_FORM, open: true })}
      >
        📍
      </button>

      <button
        className="fab-search"
        aria-label="Search visits and pins"
        title="Search visits and pins"
        onClick={() => setSearchOpen(true)}
      >
        🔍
      </button>

      {!demo && user && (
        <button
          className="signout"
          title={`Signed in as ${user.email}`}
          onClick={() => {
            if (window.confirm('Sign out?')) signOut(auth);
          }}
        >
          Sign out
        </button>
      )}

      <VisitPopup
        visit={selectedVisit}
        prospect={selectedId === PROSPECT ? currentClient : null}
        currentClient={currentClient}
        visits={visits}
        places={places}
        onClose={closeCard}
        onBack={canGoBack ? goBack : null}
        readOnly={peeking}
        className={peeking ? 'card-peek' : ''}
        onRemove={handleRemoveVisit}
        onOpenVisit={(id) => openFromCard(visitStop(id))}
        onOpenPlace={(id) => openFromCard(placeStop(id))}
        onEdit={(visit) =>
          setVisitForm({
            open: true,
            prefill: visit,
            fromProspect: false,
            editId: visit.id,
          })
        }
        onSaveProspect={() =>
          setVisitForm({
            open: true,
            prefill: currentClient,
            fromProspect: true,
            editId: null,
          })
        }
      />

      <PlaceCard
        place={selectedPlace}
        visits={visits}
        currentClient={currentClient}
        onOpenVisit={(id) => openFromCard(visitStop(id))}
        onClose={closeCard}
        onBack={canGoBack ? goBack : null}
        readOnly={peeking}
        className={peeking ? 'card-peek' : ''}
        onRemove={handleRemovePlace}
        onEdit={(p) => setPlaceForm({ open: true, prefill: p, editId: p.id })}
      />

      {searchOpen && (
        <SearchPanel
          visits={visits}
          places={places}
          onClose={() => setSearchOpen(false)}
          onPick={(id) => {
            setSearchOpen(false);
            selectVisit(id);
          }}
          onPickPlace={(id) => {
            setSearchOpen(false);
            selectPlace(id);
          }}
        />
      )}

      {visitForm.open && (
        <VisitForm
          prefill={visitForm.prefill}
          visits={visits}
          plannerEmail={invited.enabled && !visitForm.editId ? invited.plannerEmail : ''}
          editing={Boolean(visitForm.editId)}
          excludeId={visitForm.editId}
          // Looking up a nearby visit mid-entry opens it over the form rather
          // than replacing it, so nothing typed so far is lost on the way back.
          onOpenVisit={(id) => openFromCard(visitStop(id))}
          onCancel={() => setVisitForm(CLOSED_VISIT_FORM)}
          onDismiss={peeking ? goBack : () => setVisitForm(CLOSED_VISIT_FORM)}
          onSave={handleSaveVisit}
        />
      )}

      {placeForm.open && (
        <PlaceForm
          prefill={placeForm.prefill}
          editing={Boolean(placeForm.editId)}
          onCancel={() => setPlaceForm(CLOSED_PLACE_FORM)}
          onDismiss={peeking ? goBack : () => setPlaceForm(CLOSED_PLACE_FORM)}
          onSave={handleSavePlace}
        />
      )}
    </div>
  );
}
