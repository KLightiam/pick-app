# Launch checklist

Everything Pick needs before real riders and drivers use it. The code side is done. What's left is mostly accounts that have to be in Pick's (the company's) own name. Each item says which setting it fills in.

Settings go in the API's environment on the host (the same names as `apps/api/.env.example`). With `NODE_ENV=production`, the API refuses to start until the required ones are set, and prints a warning for each recommended one that's missing.

## 1. A company and the legal side

Do this first. Paystack, Stripe, Apple and Google all ask for a registered business.

- [ ] **Register the business** in Ghana, Germany, or both. Paystack needs a Ghanaian business for live payments; Stripe needs one in a supported country (Germany works).
- [ ] **Get legal advice on carrying passengers.**
  - Germany: the Passenger Transport Act (PBefG) treats paid rides as licensed transport. Commuters who only share costs may be exempt; go-anywhere drivers almost certainly need a licence (P-Schein, plus a rental-car or taxi concession).
  - Ghana: check the DVLA and Ministry of Transport rules for ride-hailing.
- [ ] **Write a privacy policy and terms of use.** Both app stores require a privacy policy link. Germany falls under the GDPR. Ghana's Data Protection Act 2012 also asks companies to register with the Data Protection Commission.
- [ ] **Confirm the driver document lists** in `packages/shared/src/markets.js` with whoever advises you.
- [ ] **Set real prices and commission** in `packages/shared/src/markets.js`. The base fares, per-km rates and the 15% commission are placeholders.

## 2. Hosting

- [ ] **A domain**, e.g. `pick.example`, with addresses for:
  - the API (`api.`)
  - the web app (the main site)
  - the dashboard (`admin.`)
- [ ] **PostgreSQL 16 with PostGIS.** Managed options include Render, Railway, Supabase, Neon, AWS RDS and Google Cloud SQL.
  - Setting: `DATABASE_URL`.
- [ ] **The API**, from the Docker image (`apps/api/Dockerfile`), on a host that supports WebSockets (Render, Railway, Fly.io, Cloud Run). Run **one instance** for now. It runs new migrations each time it starts.
  - Settings: `NODE_ENV=production`, `PUBLIC_URL=https://api.pick.example`, and `JWT_SECRET` from `openssl rand -hex 32`.
- [ ] **The web app**, as a static site: `EXPO_PUBLIC_API_URL=https://api.pick.example pnpm --filter @pick/mobile build:web`, then upload `apps/mobile/dist` to Netlify, Vercel or Cloudflare Pages.
- [ ] **The dashboard**, the same way: `VITE_API_URL=https://api.pick.example pnpm --filter @pick/admin build`, then upload `apps/admin/dist`.
- [ ] **Allow both sites to call the API:** `CORS_ORIGIN=https://pick.example,https://admin.pick.example`.
- [ ] **Make your team admins:** run `pnpm --filter @pick/api make-admin +233… "Name"` against the production database.

## 3. Sign-in by SMS: Twilio

- [ ] **A Twilio account**, upgraded from trial and with credit.
  - Settings: `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
- [ ] **The sender name** "Pick" (`TWILIO_FROM`). Check Twilio's country guidelines: Ghana needs the alphanumeric sender ID registered in advance, and Germany allows one without registering. Where a name isn't allowed, use a Twilio phone number instead.

## 4. Payments and payouts

- [ ] **Paystack (Ghana):**
  1. Activate the business account and copy the live secret key into `PAYSTACK_SECRET_KEY`.
  2. Set the webhook URL to `https://api.pick.example/payments/webhooks/paystack`.
  3. For payouts, turn off OTP for transfers under Settings → Preferences, and keep the balance funded.
- [ ] **Stripe (Germany):**
  1. Activate the account and copy the live secret key into `STRIPE_SECRET_KEY`.
  2. Add a webhook endpoint at `https://api.pick.example/payments/webhooks/stripe` sending `checkout.session.completed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
  3. For payouts, turn on Connect (Express accounts) and fill in the platform profile.
- [ ] **Try one small real payment and one payout in each country** before opening to the public.

## 5. Storage, maps and routes

- [ ] **A private bucket for driver documents:** Cloudflare R2, AWS S3, or any S3-compatible store.
  - Settings: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` (for R2), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- [ ] **A map tile provider:** MapTiler, Stadia Maps or Thunderforest all have free tiers. Set these when building the app and web app:
  - `EXPO_PUBLIC_MAP_TILES`: the provider's URL template.
  - `EXPO_PUBLIC_MAP_ATTRIBUTION`: the credit line the provider asks for.
- [ ] **Road routes:** run your own OSRM server with Ghana and Germany map data, or use a hosted routing API that speaks OSRM. Germany's data needs a server with plenty of memory (16 GB or more). The public demo server isn't allowed for production.
  - Setting: `OSRM_URL`.
- [ ] **Address search:** run your own Photon server, or pay for a hosted one. The public Photon server is for light use only.
  - Setting: `GEOCODER_URL`.

## 6. The apps in the stores

- [ ] **Choose the app ID for good** before the first store upload. It's `app.pick.mobile` now (`apps/mobile/app.json`, under `ios.bundleIdentifier` and `android.package`). Use a domain you own, reversed, e.g. `com.yourcompany.pick`. It can't change once published.
- [ ] **Replace the icons and splash screen** in `apps/mobile/assets`. They are still Expo's defaults.
- [ ] **An Expo account.** Run `npx eas init` in `apps/mobile`. This adds the project id, which push notifications need.
- [ ] **Set the API address for each build profile** in `apps/mobile/eas.json`: `EXPO_PUBLIC_API_URL` under `preview` and `production`.
- [ ] **Apple Developer Program** (99 USD a year), in the company's name. Then `eas build --platform ios --profile production` and `eas submit --platform ios`.
- [ ] **Google Play Console** (25 USD once). Then `eas build --platform android --profile production` and `eas submit --platform android`.
- [ ] **The store listings:**
  - screenshots
  - description
  - privacy policy link
  - Google's Data safety form and Apple's privacy labels (Pick collects phone number, name, location while the app is open, and driver documents)
  - Google's account-deletion link: a web page saying "Account → Delete account in the app" works
- [ ] **Location permission wording:** Apple checks it closely. The current wording is in `app.json` under `expo-location`.
- [ ] **A test account for the reviewers.** Apple and Google need to sign in, so give them a test phone number and code, or a way to get one.

## 7. Before opening the doors

- [ ] **A support contact** (email or WhatsApp) on the website and in the store listings.
- [ ] **A small closed test:** a handful of drivers and riders in one city, with test builds (`eas build --profile preview`).
- [ ] **Database backups** turned on with the database host.
- [ ] **Watch the API logs** for `Warning:` lines at start-up and for errors.
