import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sampleVisits } from '../lib/demo.js';

function friendlyError(err) {
  if (err && err.code === 'permission-denied') {
    return (
      'Firestore blocked access — make sure the security rules from ' +
      'firestore.rules are published in the Firebase console.'
    );
  }
  return (err && err.message) || 'Could not load your visits.';
}

/**
 * Live list of site visits.
 * - In demo mode: in-memory sample data, nothing saved.
 * - Live mode: real-time Firestore subscription (syncs PC ↔ phone instantly).
 *
 * Multi-user: each signed-in account's visits live under users/{uid}/visits,
 * so every user gets their own private map (enforced by firestore.rules).
 *
 * `visits` contains only upcoming visits (endTs in the future). Past visits
 * stay in Firestore untouched — they simply stop being shown.
 */
export function useVisits({ demo, user, now }) {
  const [all, setAll] = useState(() => (demo ? sampleVisits() : []));
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState('');

  useEffect(() => {
    if (demo || !user) return undefined;
    setLoading(true);
    const q = query(
      collection(db, 'users', user.uid, 'visits'),
      orderBy('endTs', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAll(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError('');
      },
      (err) => {
        setError(friendlyError(err));
        setLoading(false);
      }
    );
    return unsub;
  }, [demo, user]);

  // The map shows upcoming visits only; completed ones are hidden, not deleted.
  const visits = useMemo(
    () => all.filter((v) => Number(v.endTs) > now).sort((a, b) => a.endTs - b.endTs),
    [all, now]
  );

  async function addVisit(data) {
    if (demo) {
      const v = { ...data, id: `demo-${Date.now()}` };
      setAll((prev) => [...prev, v]);
      return v.id;
    }
    const ref = await addDoc(collection(db, 'users', user.uid, 'visits'), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async function updateVisit(id, data) {
    if (demo) {
      setAll((prev) => prev.map((v) => (v.id === id ? { ...v, ...data } : v)));
      return id;
    }
    await updateDoc(doc(db, 'users', user.uid, 'visits', id), data);
    return id;
  }

  async function removeVisit(id) {
    if (demo) {
      setAll((prev) => prev.filter((v) => v.id !== id));
      return;
    }
    await deleteDoc(doc(db, 'users', user.uid, 'visits', id));
  }

  return {
    visits,
    loading,
    error,
    addVisit,
    updateVisit,
    removeVisit,
  };
}
