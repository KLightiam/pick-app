# How Pick works

Pick lets anyone who drives earn from seats they'd otherwise leave empty. Someone driving to work turns on the app, says where they're heading, and picks up passengers going the same way, who help cover their fuel. Pick also works like a normal ride-hailing app, with drivers who'll take you anywhere.

## Two kinds of drivers

| | Commuter | Go-anywhere |
| --- | --- | --- |
| What they do | Drive to their own destination and pick up passengers on the way | Take passengers wherever they want to go, like a taxi |
| What they set when going online | Where they're heading, and how many seats to share | How many seats to share |
| What passengers pay | Less than usual (see Pricing) | The usual fare |

A driver picks their mode each time they go online.

**Seats.** Drivers set how many passenger seats their car has (1 to 8, default 4) and, each time they go online, how many of those they'll share with separate passengers. Sharing 1 seat means one booking at a time.

## Matching passengers to commuters

When a passenger asks for a ride, Pick looks for commuters whose route passes close to the pickup and who are heading the passenger's way. Matches are shown best first:

1. **Going to the same place.** The commuter's destination is within 1 km of the passenger's.
2. **Going beyond.** The passenger's destination is on the commuter's way (within 1 km of the route), so the commuter drops them and keeps going.
3. **Going partway.** The commuter heads that way but turns off before the passenger's destination. The passenger is dropped at the closest point on the commuter's route and books another ride from there. This only counts if it gets them at least 30% of the way.

Go-anywhere drivers within 5 km of the pickup are listed after the commuters. Within each group, drivers closer to the pickup come first.

**The passenger chooses.** The app shows every driver who can take them, with the kind of match, where they'd be dropped, and the price. The passenger picks one, and only that driver gets the request. If the driver doesn't accept within 60 seconds, the request is cancelled and the passenger can pick someone else.

## Solo or shared

Passengers choose:

- **Solo:** they have the car to themselves. The driver can't take anyone else until they're dropped off.
- **Shared:** other passengers can join, up to the seats the driver chose to share.

A booking can be for more than one seat, for example two friends travelling together.

## Pricing

The **usual fare** is what a normal taxi ride of that distance would cost in that market. It's always worked out for the passenger's own ride, from pickup to where they get off, not to the driver's destination.

| Ride | What the passenger pays |
| --- | --- |
| Commuter, alone in the car | 65% of the usual fare |
| Commuter, shared | Everyone sharing pays 110% of the usual fare together, so each pays less than riding alone and the driver earns a little extra |
| Go-anywhere, alone | The usual fare |
| Go-anywhere, shared | Everyone sharing pays the usual fare together, so the total equals one solo fare |

**When people get on and off at different places**, each stretch of road is split between whoever is in the car at the time. For example, Ama rides 10 km with a commuter and Esi joins for the second half. Ama pays 65% for the first 5 km alone, and the two of them split 110% for the 5 km they share. A booking for two seats pays two shares.

**The price shown is the most you pay.** When booking a shared ride, the passenger sees the solo price as the maximum, plus what it drops to if someone else shares the whole way. If others join, the final charge goes down. Kingsley chose this on 11 October 2026.

### Worked example

Usual fare from Osu to Tema: GHS 20.00.

| Who's in the commuter's car | Each pays | Driver gets |
| --- | --- | --- |
| Ama alone | GHS 13.00 | GHS 13.00 |
| Ama and Esi, whole way | GHS 11.00 | GHS 22.00 |
| Ama, Esi and Kwame, whole way | GHS 7.33 | GHS 22.00 |

## Settings we picked, and can change

These are starting points. Each lives in one place in the code and is easy to adjust.

| Setting | Value | Where |
| --- | --- | --- |
| Commuter solo price | 65% of usual (you said 60–70%) | `packages/shared/src/pricing.js` |
| Commuter shared total | 110% of usual (you said 100% or a little more) | `packages/shared/src/pricing.js` |
| Pickup distance from a commuter's route | up to 1 km | `packages/shared/src/matching.js` |
| "Same place" distance | within 1 km | `packages/shared/src/matching.js` |
| Smallest useful partway ride | 30% of the way | `packages/shared/src/matching.js` |
| Go-anywhere driver distance | up to 5 km | `packages/shared/src/matching.js` |
| Time for a driver to accept | 60 seconds | `apps/api/src/trips/dispatch.js` |
| Base fares per country | placeholders | `packages/shared/src/markets.js` |

## Known limits

- **Routes are straight lines for now.** A commuter's route is a straight line from where they are to their destination. That's fine for testing but wrong on real roads, so the next step is real road routes from a maps service.
- **Final fares aren't charged yet.** The fare-splitting is built and tested, and gets used once trips track pickup and drop-off (next step).
- **Partway passengers book their next ride themselves.** Later the app can offer to book the next leg automatically from the drop-off point.

## Build plan

1. ✅ Monorepo, API and database
2. ✅ Phone number sign-in for Ghana and Germany
3. ✅ Ride requests, offers, accept and cancel
4. ✅ Commuter and go-anywhere drivers, direction matching, solo and shared rides, fair-share pricing
5. Trip progress: driver arrived, picked up, dropped off, final fares, and booking the next leg after a partway ride
6. Real road routes and live map tracking
7. Rider and driver mobile apps (React Native), and the rider web app (React)
8. Payments: Paystack in Ghana, Stripe in Germany, and driver payouts
9. Admin dashboard: driver checks and approval, trips, support
