import { useEffect, useState } from 'react';
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
import { samplePlaces } from '../lib/demo.js';

/**
 * Live list of custom pins. Deliberately unlike useVisits: places have no
 * date, no end time, and no auto-hide — they stay on the map until removed.
 * Stored per user at users/{uid}/places, protected by the same rules.
 */
export function usePlaces({ demo, user }) {
  const [places, setPlaces] = useState(() => (demo ? samplePlaces() : []));
  const [error, setError] = useState('');

  useEffect(() => {
    if (demo || !user) return undefined;
    const q = query(collection(db, 'users', user.uid, 'places'), orderBy('name', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        setPlaces(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError('');
      },
      (err) => setError((err && err.message) || 'Could not load your pins.')
    );
  }, [demo, user]);

  async function addPlace(data) {
    if (demo) {
      const p = { ...data, id: `demo-place-${Date.now()}` };
      setPlaces((prev) => [...prev, p]);
      return p.id;
    }
    const ref = await addDoc(collection(db, 'users', user.uid, 'places'), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async function updatePlace(id, data) {
    if (demo) {
      setPlaces((prev) => prev.map((p) => (p.id === id ? { ...p, ...data } : p)));
      return id;
    }
    await updateDoc(doc(db, 'users', user.uid, 'places', id), data);
    return id;
  }

  async function removePlace(id) {
    if (demo) {
      setPlaces((prev) => prev.filter((p) => p.id !== id));
      return;
    }
    await deleteDoc(doc(db, 'users', user.uid, 'places', id));
  }

  return { places, placesError: error, addPlace, updatePlace, removePlace };
}
