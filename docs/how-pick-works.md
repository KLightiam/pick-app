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

**When the fare is worked out.** The final fare is calculated when the driver drops the passenger off, from who was in the car and for how long. Each passenger's usual fare is spread evenly over their time in the car, and each stretch is split between whoever was aboard.

**The price shown is the most you pay.** When booking a shared ride, the passenger sees the solo price as the maximum, plus what it drops to if someone else shares the whole way. If others join, the final charge goes down. Kingsley chose this on 11 October 2026.

### Worked example

Usual fare from Osu to Tema: GHS 20.00.

| Who's in the commuter's car | Each pays | Driver gets |
| --- | --- | --- |
| Ama alone | GHS 13.00 | GHS 13.00 |
| Ama and Esi, whole way | GHS 11.00 | GHS 22.00 |
| Ama, Esi and Kwame, whole way | GHS 7.33 | GHS 22.00 |

## Paying

Riders choose **cash** or **the app** when they book. Either way they pay after the drop-off, so they only ever pay the final fare, which can be lower than the price shown at booking if someone shared the car.

- **Cash:** the rider pays the driver. Pick records the fare and the commission the driver owes Pick.
- **App:** the rider taps Pay and finishes on Paystack's page (card or mobile money, Ghana) or Stripe's page (card, Germany). Card and mobile money details never touch Pick. Paystack or Stripe tells Pick when the payment goes through, and the app also checks when the rider comes back to it. Until a ride is paid, the rider can't book another.
- **Drivers** see how each ride is paid and, for the last 7 days, what they earned. Their balance nets what Pick collected for them in the app against the commission they owe on cash rides.

**Paying drivers.** Pick sends drivers their balance every week, once it's at least GHS 20 or EUR 10. In Ghana it goes to the driver's mobile money (MTN MoMo, Telecel Cash or AirtelTigo Money) through Paystack. In Germany it goes to their bank through Stripe, after they give Stripe their ID and bank details once. Admins can also press Pay now. A driver who owes Pick commission on cash rides isn't paid until what they've earned in the app covers it.

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
| Re-route a commuter who is off their route by | 500 m, at most once a minute | `apps/api/src/drivers/routeKeeper.js` |
| Base fares per country | placeholders | `packages/shared/src/markets.js` |
| Pick's commission | 15% of the fare (placeholder) | `packages/shared/src/markets.js` |
| Payment methods per country | cash and app in both | `packages/shared/src/markets.js` |
| Driver payouts | every 7 days, from GHS 20 / EUR 10 | `packages/shared/src/markets.js` |

## Known limits

- **Road routes come from OSRM**, an open-source routing engine built on OpenStreetMap. When a commuter goes online, Pick asks for the roads from where they are to their destination. As they drive, only the part of the route ahead of them can pick anyone up, and if they leave it by more than 500 m (another road), Pick asks for a new route, at most once a minute. If routing is unavailable, Pick falls back to a straight line so drivers can still go online.
- **Payouts need setting up with Paystack and Stripe.** Paystack transfers come out of Pick's Paystack balance, so it has to be topped up, and OTP for transfers has to be off. Stripe Connect has to be turned on for Pick's Stripe account. Neither has been tried with real money yet.
- **Ghanaian drivers are paid to mobile money only.** Bank accounts can be added later through the same Paystack transfers.
- **Drivers who owe Pick aren't chased.** When a driver mostly takes cash, Pick's commission builds up as a negative balance. Admins collect it by hand and record it in the dashboard.
- **Document lists are a first guess.** Ghana: licence, insurance, DVLA roadworthy certificate, car photo. Germany: licence, P-Schein, insurance, car photo. Confirm them, and whether commuters sharing costs need the same papers as taxi-style drivers, before launch. Pick doesn't track expiry dates yet.
- **Paystack needs an email address for each payment.** Riders sign in by phone, so Pick sends a made-up address based on the account (`rider-<id>@riders.pick.invalid`). Paystack's receipt emails won't reach riders until Pick asks for an email.
- **A rider could pay twice** if they open two checkout pages and pay on both. Pick counts the ride as paid once; the extra payment would need refunding by hand in Paystack or Stripe for now.
- **The live map needs a tile provider before launch.** It uses OpenStreetMap's free tiles, whose rules don't allow apps with many users. Riders still choose places by searching rather than on the map, and drivers still use the Directions button for turn-by-turn navigation.
- **Push notifications need the app built with EAS.** Ride requests and trip updates reach closed apps once the app has an EAS project and is built with it; in Expo Go and in the browser, people only see updates while the app is open. A ride request is only worth 60 seconds, so its notification is dropped if the phone can't get it in time.
- **Low ratings and reports don't act on their own.** Admins see ratings and reports in the dashboard and suspend drivers by hand. Riders' ratings are stored but not shown to drivers yet, and nobody is told when they get a report.
- **A shared trip link works until the ride ends.** Anyone who has the link sees the driver's name, plate and live location while the ride is on, so riders should send it only to people they trust.
- **Shared stretches are measured by time, not distance.** Each passenger's fare is spread over their time in the car. That's simple and needs no GPS trail, but a passenger who rides alone through heavy traffic gets a bit less of the shared discount than a distance-based split would give. This could switch to distance along the road later.

## A trip, step by step

1. The passenger asks for options and books a driver.
2. The driver accepts within 60 seconds. If their app is closed, the request reaches them as a push notification.
3. The driver taps **Arrived** at the pickup, then **Start** once the passenger is in the car. Until then, either side can cancel.
4. The driver taps **Complete** at the drop-off. The final fare is worked out and both are told. The rider pays the driver in cash, or pays in the app.
5. After a partway ride, the passenger's app gets the rest of the journey (from where they got off to where they're going) so they can book their next ride straight away.

## Build plan

1. ✅ Monorepo, API and database
2. ✅ Phone number sign-in for Ghana and Germany
3. ✅ Ride requests, offers, accept and cancel
4. ✅ Commuter and go-anywhere drivers, direction matching, solo and shared rides, fair-share pricing
5. ✅ Trip progress: driver arrived, picked up, dropped off, final fares, and the next leg after a partway ride
6. ✅ Real road routes for commuters (OSRM), re-routing, and live driver location during trips
7. ✅ The Pick mobile app: one app for riders and drivers (the account decides which screens show), with address search
8. ✅ Payments: cash or app (Paystack in Ghana, Stripe in Germany), commission and driver earnings
9. ✅ Admin dashboard: driver approval and suspension, trips, and settling money with drivers
10. ✅ Pick on the web: the same app runs in a browser, in a phone-width column on large screens, built in CI
11. ✅ Driver documents: drivers upload them in the app, admins check them in the dashboard
12. ✅ Automatic payouts to drivers: mobile money through Paystack in Ghana, bank through Stripe Connect in Germany, every week or on Pay now
13. ✅ Push notifications: ride requests for drivers and trip updates for riders when the app is closed
14. ✅ A live map: the driver's car on a map for the rider, and the next stops and route for the driver
15. ✅ Ratings and safety: riders and drivers rate each other, riders share their trip with someone, and either can report a problem
16. Getting ready to launch: real Paystack, Stripe, Twilio and storage accounts, a map tile provider, EAS builds and the app store listings
