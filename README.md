# Pick

Ride sharing for Ghana and Germany: commuters share empty seats with passengers going their way, alongside go-anywhere drivers. See [How Pick works](docs/how-pick-works.md) for the matching and pricing rules.

Pick has one mobile app for riders and drivers (React Native with Expo), an admin dashboard (React + Vite) and a Node.js + Express API.

## Layout

```
apps/api         Express API + Socket.io live updates
apps/mobile      The Pick app for riders and drivers (Expo, also runs in a browser)
apps/admin       Admin dashboard: driver approval, trips, money to settle (React + Vite)
packages/shared  Code shared by every app (fare estimates, trip statuses, geo helpers)
db/migrations    PostgreSQL + PostGIS schema
```

One app serves riders and drivers: the account's role decides which screens it shows.

## Run it locally

Needs Node 20+, pnpm and Docker.

```sh
pnpm install
pnpm db:up                         # PostGIS in Docker
cp apps/api/.env.example apps/api/.env
pnpm db:migrate
pnpm dev:api                       # http://localhost:4000/health
pnpm test
```

## API so far

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/health` | Health check |
| POST | `/auth/code` | Text a 6-digit sign-in code to `{ phone }` (+233 or +49 mobile numbers) |
| POST | `/auth/verify` | Check `{ phone, code }` and return `{ token, user }`; new accounts also send `role` (`rider` or `driver`) and optional `name` |
| GET | `/auth/me` | The signed-in user (send `Authorization: Bearer <token>`) |
| PUT, DELETE | `/auth/push-token` | `{ token, platform }` registers this phone's Expo push token; DELETE `{ token }` on sign-out |
| POST | `/trips/estimate` | Fare, distance and time for `{ country, pickup, dropoff }`, in GHS or EUR |
| POST | `/trips/options` | Drivers who can take a ride, best match first, with prices: `{ pickup, dropoff, rideType?, seats? }` |
| POST | `/trips` | Book the chosen driver: `{ driverId, pickup, dropoff, rideType?, seats?, paymentMethod?, pickupAddress?, dropoffAddress? }`; `paymentMethod` is `cash` (default) or `app` |
| GET | `/trips/active` | `{ trips }`: the rider's current trip, or the driver's current passengers (for when the app reopens) |
| GET | `/trips/offers` | Drivers: `{ offers }` still waiting to be accepted, as `trip:offer` sends them (for when the app opens from a notification) |
| GET | `/trips/:id` | The trip, for its rider and driver only |
| GET | `/trips/:id/payment` | `{ payment }` once the trip is complete: cash, or an app payment that's pending or paid |
| POST | `/trips/:id/pay` | Rider starts paying in the app: `{ checkoutUrl }` is the Paystack or Stripe page to open |
| GET | `/payments/unpaid` | The rider's ride still waiting to be paid, if any: `{ payment, trip }` |
| POST | `/payments/webhooks/paystack`, `/payments/webhooks/stripe` | Payment confirmations from Paystack and Stripe (signature checked) |
| POST | `/trips/:id/accept` | Driver accepts a ride request |
| POST | `/trips/:id/arrived` | Driver is at the pickup |
| POST | `/trips/:id/start` | Passenger is in the car |
| POST | `/trips/:id/complete` | Passenger dropped off: returns `{ trip, nextLeg }` with the final fare, and the rest of the journey after a partway ride |
| POST | `/trips/:id/cancel` | Rider or driver cancels: `{ reason? }` |
| GET | `/places/search?q=&lat=&lng=` | Address search in the user's country, nearest first: `{ places: [{ name, address, location }] }` |
| GET | `/drivers/nearby?lat=&lng=&radiusKm=` | Available drivers closest to a point |
| GET | `/drivers/me` | The driver's profile, mode, route and current load |
| GET | `/drivers/me/earnings?days=7` | Rides with what the driver earned, and their balance with Pick (all time) |
| GET | `/admin/overview?days=&country=` | Admins: drivers, riders, trips and money for the period |
| GET | `/admin/drivers?status=&q=&country=` | Admins: drivers waiting for approval, approved, or all, with rides and balance |
| POST | `/admin/drivers/:id/approval` | Admins: `{ approved }` approves a driver, or suspends them and takes them offline |
| GET | `/admin/drivers/:id/documents` | Admins: a driver's document checklist and every upload |
| GET | `/admin/documents/:id/file` | Admins: the uploaded photo or PDF |
| POST | `/admin/documents/:id/review` | Admins: `{ status: 'approved' }`, or `{ status: 'rejected', reason }` which the driver sees |
| GET | `/admin/trips?status=&country=&before=` | Admins: trips newest first, 50 at a time, with rider, driver and payment |
| GET | `/admin/balances?country=` | Admins: drivers with money to settle |
| GET, POST | `/admin/settlements` | Admins: money paid to or received from a driver outside the app `{ driverId, direction, amount, reference?, note? }` |
| GET | `/admin/payouts?status=&country=` | Admins: payouts sent to drivers, newest first |
| POST | `/admin/drivers/:id/payout` | Admins: Pay now, sending the driver their whole balance |
| PUT | `/drivers/me/vehicle` | `{ vehicleMake?, vehiclePlate?, seats }` |
| GET | `/drivers/me/documents` | The documents the driver's country asks for, each with its latest upload and status |
| PUT | `/drivers/me/documents/:kind` | Upload a document: the photo (JPEG, PNG, HEIC) or PDF is the request body, up to 8 MB |
| GET | `/drivers/me/payouts` | Where the driver is paid, how often, and past payouts |
| PUT | `/drivers/me/payout-account` | Ghana: `{ name, number, network: 'MTN' \| 'VOD' \| 'ATL' }`. Germany: `{}` returns `onboardingUrl`, Stripe's sign-up page |
| POST | `/drivers/me/status` | Go online `{ online: true, location, mode, destination?, destinationAddress?, seatsOffered? }` or offline `{ online: false }` |

Socket.io connections must sign in with `io(url, { auth: { token } })`.

| Event | Direction | Meaning |
| --- | --- | --- |
| `driver:location` | driver → server | `{ lat, lng, tripId? }` live position |
| `trip:watch` | rider → server | `{ tripId }` follow a trip |
| `trip:driver_location` | server → rider | Driver's position during the trip |
| `trip:offer` | server → driver | A passenger chose you: `{ trip, expiresAt }` |
| `trip:offer_closed` | server → driver | That request was cancelled or expired |
| `trip:accepted` | server → rider | A driver accepted: `{ trip, driver }` |
| `trip:status` | server → rider | The driver arrived or started the trip: `{ trip }` |
| `trip:completed` | server → rider | Dropped off: `{ trip, nextLeg, payment }` |
| `trip:cancelled` | server → rider/driver | The other side or the system cancelled: `{ trip }` |
| `payment:paid` | server → rider/driver | An app payment went through: `{ payment }` |

## Mobile app

```sh
pnpm dev:api                                   # in one terminal
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:4000 pnpm start
```

Scan the QR code with Expo Go on your phone (it must be on the same Wi-Fi), or press `w` to open it in a browser. `EXPO_PUBLIC_API_URL` defaults to `http://localhost:4000`, which only works in the browser or a simulator on the same computer.

- **Riders** search pickup and drop-off, choose solo or shared and seats, pick a driver from the list, then follow the trip live. After a partway ride, one tap books the rest of the way.
- **Drivers** add their car, choose commute (with a destination) or go-anywhere and how many seats to share, go online, accept requests, and tap through Arrived, Start and Drop off. Their location is sent while they're online.

With `SMS_PROVIDER=console`, sign-in codes are printed in the API terminal. New driver accounts need approving before they can go online: `pnpm --filter @pick/api approve-driver +233241234567`.

### Push notifications

When the app is closed, drivers get ride requests and riders get trip updates (driver on the way, arrived, trip complete, cancelled) as push notifications, sent through Expo's push service. Drivers also hear when a ride is paid in the app and when a payout is sent. While the app is open, the live connection shows everything and no banner pops up.

Expo push tokens need an EAS project: run `npx eas init` in `apps/mobile` once, which adds the project id to `app.json`, and build the app with EAS (push notifications don't work in Expo Go on Android). Without a project id the app runs as before, just without pushes. The API needs nothing unless "enhanced push security" is on in Expo, in which case set `EXPO_ACCESS_TOKEN`; `PUSH_NOTIFICATIONS=off` turns sending off.

### Pick on the web

The same app runs in a browser, so riders (and drivers) can use Pick without installing anything. On a wide screen it sits in a phone-width column.

```sh
EXPO_PUBLIC_API_URL=https://api.example.com pnpm --filter @pick/mobile build:web
```

This builds a static site into `apps/mobile/dist` that any static host can serve (Netlify, Vercel, Cloudflare Pages, an S3 bucket, or nginx). Add the site's address to the API's `CORS_ORIGIN`. Browsers only share location with sites on HTTPS (or `localhost`), so serve it over HTTPS.

## Admin dashboard

```sh
pnpm --filter @pick/api make-admin +233241234567 "Your name"   # once, for each admin
pnpm --filter @pick/admin dev                                   # http://localhost:5173
```

Admins sign in with their phone number and the texted code, like everyone else; only numbers made admin with `make-admin` get in. Set `VITE_API_URL` if the API isn't at `http://localhost:4000`, and add the dashboard's address to the API's `CORS_ORIGIN` in production.

- **Overview:** drivers waiting for approval and online, riders, trips by status, fares, commission, and app payments not made yet, for today, 7 or 30 days, by country.
- **Drivers:** check each driver's documents (view, approve, or reject with a reason the driver sees in the app), approve new drivers, suspend drivers (they go offline at once), search by name, phone or plate.
- **Trips:** every trip with rider, driver, route, fare, payment and who cancelled.
- **Money:** each driver's balance with Pick. Pick owes drivers what app riders paid (minus commission) and drivers owe Pick commission on cash rides. Drivers with a payout account are paid every week by themselves; Pay now sends a driver's balance at once. Every payout is listed with its outcome, and money that changes hands any other way can be recorded with its reference.

## Driver documents

Drivers photograph their documents in the app; admins check them in the dashboard. Ghana asks for a driver's licence, car insurance, a DVLA roadworthy certificate and a photo of the car; Germany asks for a licence, a passenger transport permit (P-Schein), insurance and a photo of the car. The lists are in `packages/shared/src/markets.js` and should be confirmed against local rules before launch.

Files go to a private S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) set with `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` and the usual `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Without a bucket, outside production, they're kept in `apps/api/uploads`. Files are only ever served through the API, to the driver who uploaded them and to admins.

## Payments

Riders pay after the drop-off, in cash or in the app. App payments open Paystack's checkout (card or mobile money) in Ghana and Stripe Checkout (card) in Germany. Set these in `apps/api/.env`:

- `PAYSTACK_SECRET_KEY`, and in the Paystack dashboard set the webhook URL to `<PUBLIC_URL>/payments/webhooks/paystack`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, with a Stripe webhook endpoint at `<PUBLIC_URL>/payments/webhooks/stripe` sending `checkout.session.completed`.
- `PUBLIC_URL`: where phones and the payment providers reach the API.

Use the providers' test keys while developing. With no keys at all, app payments open a test checkout page on the API itself with a Pay button, so the whole flow works locally. The API refuses to start in production without keys.

## Driver payouts

Pick pays drivers what it owes them every week, once it's at least GHS 20 or EUR 10 (`payout` in `packages/shared/src/markets.js`). The API checks every hour and pays each driver at most once a week; set `AUTO_PAYOUTS=off` to pay only when an admin presses Pay now. Drivers with a negative balance (commission owed on cash rides) and suspended drivers aren't paid automatically.

- **Ghana:** drivers add their MTN MoMo, Telecel Cash or AirtelTigo Money number in the app, and Pick sends Paystack transfers from its Paystack balance. In the Paystack dashboard, turn off OTP for transfers (otherwise every transfer waits for a code) and keep the balance topped up. Paystack's `transfer.success`, `transfer.failed` and `transfer.reversed` events arrive on the same webhook URL as payments.
- **Germany:** drivers tap Set up payouts and give their ID and bank details on Stripe's own page (Stripe Connect Express). Pick transfers their earnings to that Stripe account and Stripe pays it out to their bank. Connect must be turned on in the Stripe dashboard.

A payout counts against the driver's balance while it's on its way, so the same money is never sent twice, and a failed one puts it back. If Pick never hears how a transfer went, the hourly run asks Paystack or Stripe again. Without keys, payouts go through the test provider and always succeed.

## Address search

The apps search addresses through the API, which uses [Photon](https://photon.komoot.io), open-source geocoding on OpenStreetMap data, limited to the user's country. The public server (the default `GEOCODER_URL`) is for development; run your own Photon for production.

## Sign-in

Riders and drivers sign in with their phone number and a code sent by SMS. Codes last 5 minutes, allow 5 wrong tries, and a number can request at most 5 per hour.

Locally, `SMS_PROVIDER=console` prints codes to the API's terminal. In production set `SMS_PROVIDER=twilio` with the Twilio settings in `apps/api/.env.example`, and a strong `JWT_SECRET`.

## Markets

`packages/shared/src/markets.js` holds each country's currency, payment provider and (placeholder) pricing: Ghana uses GHS and Paystack, Germany uses EUR and Stripe.

## Ride requests

A passenger asks for options, picks a driver, and that driver has 60 seconds to accept. A rider can have one active trip at a time, and drivers take bookings up to the seats they chose to share. The rules are in [How Pick works](docs/how-pick-works.md).

New drivers can't go online until they're approved. Until the admin dashboard exists, approve one with:

```sh
pnpm --filter @pick/api approve-driver +233241234567
```

## Database tests

`apps/api/test/db.test.js` runs the API against a real PostgreSQL + PostGIS database. It runs in CI, and locally when `TEST_DATABASE_URL` is set:

```sh
pnpm db:up && pnpm db:migrate
TEST_DATABASE_URL=postgres://pick:pick@localhost:5432/pick pnpm test
```

## Road routes

Commuters' routes come from [OSRM](https://project-osrm.org), open-source routing on OpenStreetMap data. Set `ROUTING_PROVIDER` and `OSRM_URL` in `apps/api/.env`:

- **Development:** the default is OSRM's public demo server, which is fine for trying things out but not for real traffic.
- **Production:** run your own OSRM server with the Ghana and Germany map extracts from [Geofabrik](https://download.geofabrik.de), for example with the `osrm/osrm-backend` Docker image, and point `OSRM_URL` at it.
- **Tests:** `ROUTING_PROVIDER=straight` uses straight lines.

If OSRM can't be reached, the API falls back to a straight line and logs a warning, so drivers can still go online.
