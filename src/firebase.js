import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// These values are injected at build time from VITE_FIREBASE_* env vars.
// They are safe to ship to the browser — protection comes from
// firestore.rules + Google sign-in, not from hiding this config.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True once all four VITE_FIREBASE_* vars are set. Until then the app runs in demo mode. */
export const firebaseReady = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId
);

let db = null;
let auth = null;
let googleProvider = null;

if (firebaseReady) {
  const app = initializeApp(config);
  // Offline-friendly cache so the map still opens on a flaky mobile connection.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
}

export { db, auth, googleProvider };
