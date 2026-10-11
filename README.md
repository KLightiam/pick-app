# Pick

Ride sharing for Ghana and Germany: commuters share empty seats with passengers going their way, alongside go-anywhere drivers. See [How Pick works](docs/how-pick-works.md) for the matching and pricing rules.

Pick will have rider and driver mobile apps (React Native), a rider web app and admin dashboard (React), and a Node.js + Express API. So far the API is built.

## Layout

```
apps/api         Express API + Socket.io live updates
packages/shared  Code shared by every app (fare estimates, trip statuses, geo helpers)
db/migrations    PostgreSQL + PostGIS schema
```

Coming next: `apps/rider`, `apps/driver` (Expo), `apps/web` (React + Vite).

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
| POST | `/trips` | Book the chosen driver: `{ driverId, pickup, dropoff, rideType?, seats?, pickupAddress?, dropoffAddress? }` |
| GET | `/trips/:id` | The trip, for its rider and driver only |
| POST | `/trips/:id/accept` | Driver accepts a ride request |
| POST | `/trips/:id/arrived` | Driver is at the pickup |
| POST | `/trips/:id/start` | Passenger is in the car |
| POST | `/trips/:id/complete` | Passenger dropped off: returns `{ trip, nextLeg }` with the final fare, and the rest of the journey after a partway ride |
| POST | `/trips/:id/cancel` | Rider or driver cancels: `{ reason? }` |
| GET | `/drivers/nearby?lat=&lng=&radiusKm=` | Available drivers closest to a point |
| GET | `/drivers/me` | The driver's profile, mode, route and current load |
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
| `trip:completed` | server → rider | Dropped off: `{ trip, nextLeg }` |
| `trip:cancelled` | server → rider/driver | The other side or the system cancelled: `{ trip }` |

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
