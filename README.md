# Pick

Ride hailing app: rider and driver mobile apps (React Native), a web app and admin dashboard (React), and a Node.js + Express API.

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
| POST | `/trips/estimate` | Fare, distance and time for `{ pickup, dropoff }` |
| GET | `/drivers/nearby?lat=&lng=&radiusKm=` | Online drivers closest to a point |

Socket.io events: drivers send `driver:location`; riders send `trip:watch` and receive `trip:driver_location`.
