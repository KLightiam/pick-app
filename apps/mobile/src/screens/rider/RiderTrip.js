import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { distanceKm } from '@pick/shared';
import { api } from '../../api-instance.js';
import { CANCELLABLE, TRIP_STATUS_LABELS, formatKm, formatMoney } from '../../format.js';
import { useLiveEvent } from '../../live.js';
import { Body, Button, Card, ErrorText, Screen, Title } from '../../ui.js';

/** A booked ride as it happens: waiting for the driver, on the way, and the final fare. */
export default function RiderTrip({ booking, live, onDone }) {
  const [trip, setTrip] = useState(booking.trip);
  const [driver, setDriver] = useState(booking.option?.driver ?? null);
  const [driverAt, setDriverAt] = useState(null);
  const [nextLeg, setNextLeg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const mine = (payload) => payload?.trip?.id === trip.id;

  // Watch this trip's room for the driver's position, again after every reconnect.
  const refresh = useCallback(async () => {
    live?.emit('trip:watch', { tripId: trip.id });
    try {
      const { trip: latest } = await api.trip(trip.id);
      setTrip(latest);
    } catch { /* keep what we have; the next event will update it */ }
  }, [live, trip.id]);
  useEffect(() => { refresh(); }, [refresh]);
  useLiveEvent(live, 'connect', refresh);

  useLiveEvent(live, 'trip:accepted', (p) => { if (mine(p)) { setTrip(p.trip); setDriver(p.driver); } });
  useLiveEvent(live, 'trip:status', (p) => { if (mine(p)) setTrip(p.trip); });
  useLiveEvent(live, 'trip:cancelled', (p) => { if (mine(p)) setTrip(p.trip); });
  useLiveEvent(live, 'trip:completed', (p) => { if (mine(p)) { setTrip(p.trip); setNextLeg(p.nextLeg); } });
  useLiveEvent(live, 'trip:driver_location', setDriverAt);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const { trip: cancelled } = await api.cancel(trip.id, 'rider_cancelled');
      setTrip(cancelled);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const awayKm = driverAt && ['accepted'].includes(trip.status) ? distanceKm(driverAt, trip.pickup) : null;
  const finished = trip.status === 'completed' || trip.status === 'cancelled';

  return (
    <Screen>
      <Title>{TRIP_STATUS_LABELS[trip.status]}</Title>
      {trip.status === 'requested' && (
        <Body muted>If the driver doesn't accept within a minute, you can choose someone else.</Body>
      )}
      {driver && (
        <Card>
          <Body style={{ fontWeight: '600' }}>{driver.name ?? 'Your driver'}</Body>
          <Body muted>{[driver.vehicleMake, driver.vehiclePlate].filter(Boolean).join(' · ')}</Body>
          {awayKm !== null && <Body>{formatKm(awayKm)} away</Body>}
        </Card>
      )}
      <Card>
        <Body muted>From</Body>
        <Body>{trip.pickupAddress ?? 'Where you were when you booked'}</Body>
        <Body muted>To</Body>
        <Body>{trip.dropoffAddress ?? 'Drop-off'}</Body>
        {trip.matchType === 'partial' && (
          <Body muted>This driver takes you part of the way. You can book the rest when you get out.</Body>
        )}
      </Card>

      {trip.status === 'completed'
        ? <Body style={{ fontSize: 20, fontWeight: '700' }}>Your fare: {formatMoney(trip.fareFinal, trip.currency)}</Body>
        : !finished && <Body>Up to {formatMoney(trip.fareEstimate, trip.currency)}</Body>}
      {trip.status === 'cancelled' && trip.cancelReason === 'no_driver_accepted' && (
        <Body>The driver didn't accept in time. Choose another driver.</Body>
      )}

      <ErrorText>{error}</ErrorText>
      <View style={{ gap: 10, marginTop: 'auto' }}>
        {nextLeg && (
          <Button
            title={`Book the rest of the way (${formatKm(nextLeg.remainingKm)})`}
            onPress={() => onDone({ nextLeg })}
          />
        )}
        {finished && <Button title={nextLeg ? 'Done' : 'Book another ride'} variant={nextLeg ? 'secondary' : 'primary'} onPress={() => onDone({})} />}
        {CANCELLABLE.includes(trip.status) && (
          <Button title="Cancel ride" variant="secondary" onPress={cancel} busy={busy} />
        )}
        {trip.status !== 'requested' && !finished && (
          <Button title="Emergency: call 112" variant="danger" onPress={() => Linking.openURL('tel:112')} />
        )}
      </View>
    </Screen>
  );
}
