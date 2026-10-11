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
| POST | `/trips/estimate` | Fare, distance and time for `{ country, pickup, dropoff }`, in GHS or EUR |
| POST | `/trips/options` | Drivers who can take a ride, best match first, with prices: `{ pickup, dropoff, rideType?, seats? }` |
| POST | `/trips` | Book the chosen driver: `{ driverId, pickup, dropoff, rideType?, seats?, paymentMethod?, pickupAddress?, dropoffAddress? }`; `paymentMethod` is `cash` (default) or `app` |
| GET | `/trips/active` | `{ trips }`: the rider's current trip, or the driver's current passengers (for when the app reopens) |
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
| GET | `/admin/trips?status=&country=&before=` | Admins: trips newest first, 50 at a time, with rider, driver and payment |
| GET | `/admin/balances?country=` | Admins: drivers with money to settle |
| GET, POST | `/admin/settlements` | Admins: money paid to or received from a driver outside the app `{ driverId, direction, amount, reference?, note? }` |
| PUT | `/drivers/me/vehicle` | `{ vehicleMake?, vehiclePlate?, seats }` |
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
- **Drivers:** approve new drivers once their car is added, suspend drivers (they go offline at once), search by name, phone or plate.
- **Trips:** every trip with rider, driver, route, fare, payment and who cancelled.
- **Money:** each driver's balance with Pick. Pick owes drivers what app riders paid (minus commission) and drivers owe Pick commission on cash rides. Send the money by MoMo or bank transfer and record it here with its reference.

## Payments

Riders pay after the drop-off, in cash or in the app. App payments open Paystack's checkout (card or mobile money) in Ghana and Stripe Checkout (card) in Germany. Set these in `apps/api/.env`:

- `PAYSTACK_SECRET_KEY`, and in the Paystack dashboard set the webhook URL to `<PUBLIC_URL>/payments/webhooks/paystack`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, with a Stripe webhook endpoint at `<PUBLIC_URL>/payments/webhooks/stripe` sending `checkout.session.completed`.
- `PUBLIC_URL`: where phones and the payment providers reach the API.

Use the providers' test keys while developing. With no keys at all, app payments open a test checkout page on the API itself with a Pay button, so the whole flow works locally. The API refuses to start in production without keys.

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
