import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, View } from 'react-native';
import { api } from '../../api-instance.js';
import {
  DRIVER_NEXT_STEP, MATCH_LABELS, describePayment, directionsUrl, formatMoney, liveOffers, secondsLeft,
} from '../../format.js';
import { useLiveEvent } from '../../live.js';
import { watchLocation } from '../../location.js';
import LiveMap from '../../map/LiveMap.js';
import { driverScene } from '../../map/scene.js';
import { Body, Button, Card, ErrorText, Title, styles } from '../../ui.js';

/** Online: ride requests come in, the driver accepts them and takes each passenger through their trip. */
export default function Driving({ driver, status, live, onOffline }) {
  const [offers, setOffers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [riders, setRiders] = useState({}); // tripId -> { name, phone }, from accepting
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // the last finished trip and its payment
  const [me, setMe] = useState(null); // where the car is

  // Also when the app comes back from the background, e.g. opened from a ride request notification.
  const loadTrips = useCallback(async () => {
    try {
      const [{ trips: active }, { offers: waiting }] = await Promise.all([api.activeTrips(), api.openOffers()]);
      setTrips(active);
      setOffers(waiting.reverse()); // newest first, like live offers
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { loadTrips(); }, [loadTrips]);
  useLiveEvent(live, 'connect', loadTrips);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') loadTrips(); });
    return () => sub.remove();
  }, [loadTrips]);

  // Count down offers once a second; expired ones drop off the list.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useLiveEvent(live, 'payment:paid', ({ payment }) => {
    setDone((d) => (d?.trip.id === payment.tripId ? { ...d, payment } : d));
  });
  useLiveEvent(live, 'trip:offer', (offer) => setOffers((list) => [offer, ...list]));
  useLiveEvent(live, 'trip:offer_closed', ({ tripId }) => setOffers((list) => list.filter((o) => o.trip.id !== tripId)));
  useLiveEvent(live, 'trip:cancelled', ({ trip }) => {
    setOffers((list) => list.filter((o) => o.trip.id !== trip.id));
    setTrips((list) => list.filter((t) => t.id !== trip.id));
    setError('A passenger cancelled their ride.');
  });

  // Send the car's position while online, tagged with a trip so its passenger can follow along.
  const tripsRef = useRef(trips);
  tripsRef.current = trips;
  useEffect(() => {
    let stop;
    let stopped = false;
    watchLocation((point) => {
      setMe(point);
      const active = tripsRef.current;
      if (active.length === 0) live?.emit('driver:location', point);
      for (const t of active) live?.emit('driver:location', { ...point, tripId: t.id });
    }).then((s) => { if (stopped) s(); else stop = s; }).catch((err) => setError(err.message));
    return () => { stopped = true; stop?.(); };
  }, [live]);

  const act = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      if (err.status === 409 || err.status === 404) loadTrips();
    } finally {
      setBusy(null);
    }
  };

  const accept = (offer) => act(`accept:${offer.trip.id}`, async () => {
    setOffers((list) => list.filter((o) => o.trip.id !== offer.trip.id));
    const { trip, rider } = await api.accept(offer.trip.id);
    setRiders((r) => ({ ...r, [trip.id]: rider }));
    setTrips((list) => [...list, trip]);
  });

  const advance = (trip) => act(`trip:${trip.id}`, async () => {
    const step = DRIVER_NEXT_STEP[trip.status];
    const result = await api[step.call](trip.id);
    if (result.trip.status === 'completed') {
      setTrips((list) => list.filter((t) => t.id !== trip.id));
      setDone({ trip: result.trip, payment: result.payment });
    } else {
      setTrips((list) => list.map((t) => (t.id === trip.id ? result.trip : t)));
    }
  });

  const cancelTrip = (trip) => act(`cancel:${trip.id}`, async () => {
    await api.cancel(trip.id, 'driver_cancelled');
    setTrips((list) => list.filter((t) => t.id !== trip.id));
  });

  const goOffline = () => act('offline', async () => {
    await api.setDriverStatus({ online: false });
    onOffline();
  });

  const open = liveOffers(offers, now);
  const route = status.mode === 'commute' ? (status.route?.points ?? driver.route) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Title>You're online</Title>
      <Body muted>
        {status.mode === 'commute'
          ? `Heading to ${driver.destinationAddress ?? status.destinationAddress ?? 'your destination'}`
          : 'Going anywhere'}
        {` · sharing ${status.seatsOffered} ${status.seatsOffered === 1 ? 'seat' : 'seats'}`}
      </Body>

      {(trips.length > 0 || route) && <LiveMap scene={driverScene({ me, trips, route })} height={220} />}

      {done && (
        <Card>
          <Body style={{ fontWeight: '600' }}>Trip finished</Body>
          <Body>Fare: {formatMoney(done.trip.fareFinal, done.trip.currency)}</Body>
          <Body style={{ fontWeight: '600' }}>{describePayment(done.payment, 'driver')}</Body>
        </Card>
      )}

      {open.map((offer) => (
        <Card key={offer.trip.id}>
          <View style={styles.row}>
            <Body style={{ fontWeight: '600' }}>New ride request</Body>
            <Body muted>{secondsLeft(offer.expiresAt, now)}s</Body>
          </View>
          <Body>{offer.trip.pickupAddress ?? 'Where the passenger booked from'} → {offer.trip.dropoffAddress ?? 'Drop-off'}</Body>
          <Body muted>
            {MATCH_LABELS[offer.trip.matchType]} · {offer.trip.rideType === 'shared' ? 'Shared' : 'Solo'}
            {` · ${offer.trip.seats} ${offer.trip.seats === 1 ? 'seat' : 'seats'}`}
          </Body>
          <Body>Up to {formatMoney(offer.trip.fareEstimate, offer.trip.currency)} · {offer.trip.paymentMethod === 'app' ? 'paid in the app' : 'cash'}</Body>
          <Button title="Accept" onPress={() => accept(offer)} busy={busy === `accept:${offer.trip.id}`} />
        </Card>
      ))}

      {trips.map((trip) => {
        const step = DRIVER_NEXT_STEP[trip.status];
        const rider = riders[trip.id];
        return (
          <Card key={trip.id}>
            <Body style={{ fontWeight: '600' }}>{rider?.name ?? 'Passenger'}</Body>
            <Body muted>{trip.status === 'in_progress' ? 'Drop off at' : 'Pick up at'}</Body>
            <Body>
              {trip.status === 'in_progress'
                ? (trip.matchType === 'partial' ? 'Where your route leaves theirs' : trip.dropoffAddress ?? 'Drop-off')
                : trip.pickupAddress ?? 'Where the passenger booked from'}
            </Body>
            <Button
              title="Directions"
              variant="secondary"
              onPress={() => Linking.openURL(directionsUrl(trip.status === 'in_progress' ? (trip.alight ?? trip.dropoff) : trip.pickup))}
            />
            {step && <Button title={step.label} onPress={() => advance(trip)} busy={busy === `trip:${trip.id}`} />}
            {rider?.phone && <Button title="Call passenger" variant="secondary" onPress={() => Linking.openURL(`tel:${rider.phone}`)} />}
            {trip.status !== 'in_progress' && (
              <Button title="Cancel" variant="secondary" onPress={() => cancelTrip(trip)} busy={busy === `cancel:${trip.id}`} />
            )}
          </Card>
        );
      })}

      {open.length === 0 && trips.length === 0 && (
        <Body muted>Waiting for ride requests. Passengers choose you from the list of drivers going their way.</Body>
      )}

      <ErrorText>{error}</ErrorText>
      <Button title="Go offline" variant="secondary" onPress={goOffline} busy={busy === 'offline'} />
    </ScrollView>
  );
}
