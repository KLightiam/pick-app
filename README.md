# Pick

Ride hailing app for Ghana and Germany: rider and driver mobile apps (React Native), a web app and admin dashboard (React), and a Node.js + Express API.

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
| GET | `/drivers/nearby?lat=&lng=&radiusKm=` | Online drivers closest to a point |

Socket.io connections must sign in with `io(url, { auth: { token } })`. Drivers send `driver:location`; riders send `trip:watch` and receive `trip:driver_location`.

## Sign-in

Riders and drivers sign in with their phone number and a code sent by SMS. Codes last 5 minutes, allow 5 wrong tries, and a number can request at most 5 per hour.

Locally, `SMS_PROVIDER=console` prints codes to the API's terminal. In production set `SMS_PROVIDER=twilio` with the Twilio settings in `apps/api/.env.example`, and a strong `JWT_SECRET`.

## Markets

`packages/shared/src/markets.js` holds each country's currency, payment provider and (placeholder) pricing: Ghana uses GHS and Paystack, Germany uses EUR and Stripe.
