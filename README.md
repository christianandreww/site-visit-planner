# Site Visit Planner

All your upcoming site visits as pins on a Singapore map, so that when a new
client says yes to a site visit mid-call, you can see in seconds which existing
appointments are nearby and pick a slot that makes geographical sense.

**▶ Try it live (no sign-up):** <https://site-visit-planner.vercel.app/?demo=1>
— the real app running on sample data.

## How this project was built

I built this for a friend who works in solar sales in Singapore — I'm not a
software developer, and the problem isn't mine. It's his: checking appointment
geography in Google Maps while a client waited on the phone. What I brought was
the product design — working through his daily routine with him, deciding what
the tool had to answer in the middle of a client call, and deliberately keeping
it a geographic layer over his calendar rather than a replacement for it.

The implementation was AI-assisted: I worked with Claude (Anthropic) to design
the architecture and write the code. I set up and configured the
infrastructure myself — the OneMap API account, Firebase with Google sign-in
and per-user security rules, Vercel deployment and environment variables —
debugged the launch end to end, and have kept refining the app on his feedback
since. I'm noting this openly because it's the honest shape of the work.

The app runs in **demo mode with sample data** until Firebase is configured,
so you can deploy it (or run `npm run dev`) and click around before doing any
setup. Nothing in demo mode is saved.

**Multi-user:** anyone you give the URL to signs in with their own Google
account and gets their **own private map** — no per-user setup, and nobody
can see anyone else's clients or visits.

**Stack:** React + Vite · Leaflet with OneMap (SLA) basemap · OneMap search &
driving-route APIs · Firebase Firestore (real-time sync between each user's
PC and phone) · Google sign-in · two serverless functions on Vercel that keep
the OneMap credentials server-side. Everything runs on free tiers.

---

## How the pieces fit

- The browser app shows the map, pins, and forms. It talks to Firestore
  directly; each user's visits are stored under their own account, and
  `firestore.rules` guarantees no user can read or write anyone else's data.
- Address search and driving times go through `/api/search` and `/api/route` —
  tiny serverless functions deployed together with the app. Only these
  functions know `ONEMAP_EMAIL` / `ONEMAP_PASSWORD`; they fetch the OneMap
  access token, cache it, and refresh it automatically about 6 hours before
  its 3-day expiry. Your password and the token never reach the browser.
- Past visits are hidden from the map once their end time passes, but the
  records stay in Firestore untouched.

---

## Setup (one-time, ~20 minutes, all free)

You need three free accounts: OneMap, Firebase (any Google account), and
Vercel.

### Part 1 — OneMap account (2 min)

1. Register at <https://www.onemap.gov.sg/apidocs/register> with an email and
   password, and verify the email.
2. That email + password are your `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` values
   for Part 3. You never need to touch tokens yourself.

### Part 2 — Firebase project (10 min)

1. Go to <https://console.firebase.google.com> → **Add project** → name it
   (e.g. `site-visit-planner`) → Google Analytics **off** → Create.
2. **Build → Firestore Database → Create database** → start in **production
   mode** → location **asia-southeast1 (Singapore)** → Enable.
3. Open the **Rules** tab, replace everything with the contents of
   [`firestore.rules`](./firestore.rules), and **Publish**. No editing
   needed — the rules give every signed-in Google account its own private
   set of visits and block access to everyone else's.
4. **Build → Authentication → Get started → Sign-in method** → enable
   **Google** → set the support email → Save.
5. **Project settings (gear icon) → General → Your apps → Web app (`</>`)** →
   give it any nickname → Register (skip Firebase Hosting). Copy these four
   values from the config it shows:

   | Firebase config | Environment variable        |
   | --------------- | --------------------------- |
   | `apiKey`        | `VITE_FIREBASE_API_KEY`     |
   | `authDomain`    | `VITE_FIREBASE_AUTH_DOMAIN` |
   | `projectId`     | `VITE_FIREBASE_PROJECT_ID`  |
   | `appId`         | `VITE_FIREBASE_APP_ID`      |

### Part 3 — Deploy to Vercel (10 min)

**Option A — straight from this folder (no GitHub needed):**

1. Install Node.js 18+ from <https://nodejs.org> if you don't have it.
2. In the project folder run `npx vercel login`, then `npx vercel` and accept
   the defaults (it auto-detects Vite).
3. In the Vercel dashboard open the new project → **Settings → Environment
   Variables** and add all six, for the Production environment:
   `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, `VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID`.
4. Run `npx vercel --prod`. (Any time you change env vars, run this again —
   the `VITE_` values are baked in at build time.)

**Option B — via GitHub:** push this folder to a GitHub repo, then at
<https://vercel.com/new> import it, paste the six env vars during import, and
Deploy. Future `git push`es redeploy automatically.

**Last step (important):** in Firebase go to **Authentication → Settings →
Authorized domains** → **Add domain** → add your `something.vercel.app`
domain. Without this, Google sign-in on the deployed site is refused.

### Part 4 — Put it on your phone and PC

Open the Vercel URL and sign in with Google — the same data appears
everywhere, updating in real time.

- iPhone (Safari): Share button → **Add to Home Screen**.
- Android (Chrome): menu → **Add to Home screen / Install app**.

---

## Giving it to your users

Rolling it out is just sharing the URL. Each person signs in with their own
Google account and immediately has their own empty private map — there is
nothing for you to configure per user, no accounts to create, and no way for
one user to see another's clients.

Two things are shared behind the scenes and worth knowing as the operator:
every user's address searches and driving-time lookups go through **your**
OneMap account (limit 250 requests/min — comfortable for dozens of active
users), and all data lives in **your** Firebase project's free quota (50k
reads / 20k writes per day; a heavy user generates a few hundred a day). If
you ever want to restrict who can sign in rather than leaving it open, an
approved-emails list can be added to `firestore.rules` later without touching
the app code.

One licence note: Vercel's free **Hobby** tier is for personal,
non-commercial use. Running this free for colleagues is one thing, but if it
becomes a paid or company product, move the project to Vercel **Pro** (or
host on your company's account).

---

## Using it — the 30-second flow

1. Client agrees to a site visit while you're on the call.
2. Open the app. Type their name and address (street name or postal code) in
   the top bar and tap the correct suggestion.
3. They appear instantly as a pulsing **orange pin**, and the card lists your
   **nearest upcoming visits** with distances.
4. Tap any nearby pin: its card shows client, address, date, time, the
   straight-line distance from your new client, the **driving time** by road,
   and the **public transport route** — planned to get you there *for* the
   appointment, with the time to leave by and how much of the journey is
   walking and waiting (all fetched from OneMap on the spot). A **‹ Back**
   button returns you to whichever card you came from.
5. Check your calendar, agree a slot with the client, then tap **Save visit**.
   The form shows the **three nearest upcoming visits** — with distance,
   driving time, and public-transport time — the moment the address is
   pinned, so you can see the geography before choosing a date. Fill in date,
   start, and end. The orange pin turns into a normal blue
   pin, synced to all your devices.

**Custom pins** are a separate, permanent layer: tap 📍 to drop a named marker
in your own colour — Home, School, the office, a supplier's yard — at any
address. They carry no date or time, never expire, and stay on the map until
you remove them, while site visits keep all the scheduling. Tapping one shows
the site visits nearest to it, with travel times — handy for "what's near the
office this week?". Round blue pins are
scheduled visits, the pulsing orange one is the client you're on the phone
with, and rounded-square coloured pins with a letter are yours.

Each visit pin carries a small **order number** in an iOS-style badge — 1 is your next visit, so the
week reads as a route without opening a single card — and a label that is the
**weekday only while that is unambiguous**: within the next 7 days a pin says
"Thu", beyond that it shows the date ("3/9"), so this Thursday and Thursday
fortnight can never look alike. A far-off visit flips to its weekday on its own
as the date approaches. Visit cards also show **From your pins** — how far the
visit is from each custom pin, with driving time.

A visit pin's **shade of blue says how soon it is**: dark blue within the next
7 days (the same days its label names the weekday), the usual blue for the week
after, and a lighter blue — one shade darker than the sea — from two weeks out.
A key in the bottom corner says which is which, and where pins overlap the
sooner visit stays on top.

Other behaviour worth knowing: tapping the map background closes the card; **Edit visit** on a
card reopens the form pre-filled so you can change anything (clash warnings
included), and **Remove** deletes an entry; pins disappear on their own once
the visit's end time passes, but the record remains in Firestore; add
`?demo=1` to the URL any time to poke around with sample data.

---

## Calendar invites (optional)

The planner can have its own email address, the way meeting notetakers do.
A rep creates the site visit in their own calendar and adds the planner's
address as a guest. The visit appears on that rep's map by itself, and moves
or disappears when the event is moved or cancelled.

The address can go in either of two places:

- **Location** — e.g. `Blk 123 Serangoon Ave 3, #05-12, Singapore 550123`.
- **The title**, when Location is left empty or can't be found — e.g.
  `Site visit – Mr Tan, 550123` or `Mr Tan at 1 Sireh Place`. The address is
  taken out of the title, so the map still shows the client as "Mr Tan".

A postal code is the surest way to get the right pin. A street address
without one is only used when OneMap finds that exact block number; anything
the map can't place is listed at the top of the map instead of guessed.

How it works: invitations land in the planner's own Google Calendar. The
`/api/invites` function reads that calendar's private iCal feed, keeps the
upcoming events organised by the signed-in rep (checked with their Firebase
sign-in token), finds each address with OneMap, and hands them to the map.
Nothing is stored; calendar visits are read-only on the map.

Setup:

1. Create a Google account for the planner (a company address is best; a
   free Gmail works for trying it out).
2. In that account's Google Calendar → **Settings → Event settings → Add
   invitations to my calendar**, choose **From everyone**. (On a company
   address, colleagues already count as known senders.)
3. **Settings → the calendar → Integrate calendar → Secret address in iCal
   format** — copy it. It's the last one, hidden behind dots; not the *Public
   address in iCal format* above it, which only works on a public calendar.
   Treat it like a password.
4. In Vercel → **Settings → Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `PLANNER_ICAL_URL` | the secret iCal address from step 3 |
   | `PLANNER_EMAIL` | the planner's email address (shown to reps as a reminder) |
   | `PLANNER_EMAIL_ALIASES` | *optional* — only if a rep sends invites from a different address than they sign in with: `signin@gmail.com=work@company.com` (separate several reps with `;`) |

5. Redeploy. Without `PLANNER_ICAL_URL` the feature stays switched off.

Only events organised by a signed-in rep are ever shown, and only to that
rep, so stray or spam invitations to the planner never reach a map.

---

## Local development (optional)

```bash
cp .env.example .env    # fill in the same six values
npm install
npm run dev             # app + /api functions at http://localhost:5173
npm test                # unit tests for the API functions and helpers
```

The dev server bridges `/api/*` to the same serverless code Vercel runs, so
address search and driving times work locally too. Restart `npm run dev` if
you edit files inside `api/`.

---

## Troubleshooting

- **Address search shows "OneMap: Authentication token missing"** — the
  OneMap env vars are missing or wrong on Vercel. Fix them and redeploy.
- **Google sign-in fails with `auth/unauthorized-domain`** — add your Vercel
  domain under Firebase → Authentication → Settings → Authorized domains.
- **The map says the planner calendar couldn't be read** — `PLANNER_ICAL_URL`
  must be the calendar's *Secret* address in iCal format (it contains
  `private-` and ends in `basic.ics`). If it already is, the address may have
  been reset since: copy it again. Redeploy after changing it. Never make the
  calendar public instead — that shows every visit to anyone.
- **"Firestore blocked access…"** — the security rules from
  `firestore.rules` haven't been published (or were pasted into a different
  Firebase project). Paste and Publish them in the Firebase console.
- **The app is in demo mode after deploying** — one or more
  `VITE_FIREBASE_*` vars are missing. Add them and redeploy.
- **Drive time says "unavailable"** — usually a blip or an unroutable point;
  the straight-line distance still shows. If it never works, check the OneMap
  env vars.
- **Public transport shows a dash (`🚌 —`)** — there is no bus or train route
  between those two points that OneMap will plan. The app deliberately shows
  nothing rather than a number: OneMap answers an impossible transit query by
  walking you the whole way instead of refusing, which used to surface as a
  believable-looking three-hour "journey".
- **A transit time has an asterisk** — the visit is far enough ahead that
  timetables for that day are not published yet, so the answer is for the same
  weekday and time in the coming week. It will sharpen as the date approaches.

## Costs and limits

Everything fits comfortably in free tiers well beyond a one-person setup:
OneMap is free (250 requests/min across all your users — far beyond what
scheduling calls generate), Firebase's Spark plan includes 50k reads and 20k
writes per day shared across users, and Vercel's Hobby plan covers the
hosting and serverless functions for non-commercial use. No credit card
required anywhere.

API references: [OneMap API docs](https://www.onemap.gov.sg/apidocs/) ·
[Firebase docs](https://firebase.google.com/docs) ·
[Vercel docs](https://vercel.com/docs)
