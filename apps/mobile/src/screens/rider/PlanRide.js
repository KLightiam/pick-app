import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api } from '../../api-instance.js';
import PlaceSearch from '../../components/PlaceSearch.js';
import { MATCH_LABELS, describeDropoff, describeFare, formatKm } from '../../format.js';
import { Body, Button, Card, Choice, ErrorText, Stepper, Title, styles } from '../../ui.js';

const RIDE_TYPES = [
  { value: 'solo', label: 'Just me' },
  { value: 'shared', label: 'Happy to share' },
];

/**
 * Where from, where to, solo or shared: then the drivers who can take you, best match first.
 * `start` can pre-fill pickup and drop-off (for booking the rest of a partway ride).
 */
export default function PlanRide({ start, onBooked }) {
  const [pickup, setPickup] = useState(start?.pickup ?? null);
  const [dropoff, setDropoff] = useState(start?.dropoff ?? null);
  const [rideType, setRideType] = useState('solo');
  const [seats, setSeats] = useState(1);
  const [options, setOptions] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ride = () => ({
    pickup: pickup.location,
    dropoff: dropoff.location,
    pickupAddress: placeLabel(pickup),
    dropoffAddress: placeLabel(dropoff),
    rideType,
    seats,
  });

  const changed = (set) => (v) => { set(v); setOptions(null); setChosen(null); };

  const findDrivers = async () => {
    setBusy(true);
    setError(null);
    try {
      const { options: found } = await api.rideOptions(ride());
      setOptions(found);
      setChosen(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const book = async () => {
    setBusy(true);
    setError(null);
    try {
      const { trip, expiresAt } = await api.book({ ...ride(), driverId: chosen.driverId });
      onBooked({ trip, option: chosen, expiresAt });
    } catch (err) {
      setError(err.message);
      if (err.status === 409) findDrivers();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Title>Where to?</Title>
      <PlaceSearch
        label="Pickup"
        placeholder="Where are you?"
        value={pickup}
        onChange={changed(setPickup)}
        allowCurrentLocation
      />
      <PlaceSearch
        label="Drop-off"
        placeholder="Where are you going?"
        value={dropoff}
        onChange={changed(setDropoff)}
        near={pickup?.location}
      />
      <Choice options={RIDE_TYPES} value={rideType} onChange={changed(setRideType)} />
      <Body muted>
        {rideType === 'shared'
          ? 'You pay at most the price shown. It drops if someone else shares the car with you.'
          : 'The car is yours for this ride.'}
      </Body>
      <Stepper label="Seats" value={seats} min={1} max={8} onChange={changed(setSeats)} />
      <Button title="Find drivers" onPress={findDrivers} busy={busy && !options} disabled={!pickup || !dropoff} />

      {options && options.length === 0 && (
        <Body muted>No drivers can take this ride right now. Try again in a few minutes.</Body>
      )}
      {options?.map((o) => (
        <OptionCard key={o.driverId} option={o} selected={chosen?.driverId === o.driverId} onPress={() => setChosen(o)} />
      ))}
      {chosen && (
        <Button title={`Request ${chosen.driver.name ?? 'this driver'}`} onPress={book} busy={busy} />
      )}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}

// "Current location" means nothing to the driver, so it isn't sent as an address.
const placeLabel = (place) => (place.current ? undefined : place.address ?? place.name);

function OptionCard({ option, selected, onPress }) {
  const { driver, fare } = option;
  return (
    <Card onPress={onPress} selected={selected}>
      <View style={styles.row}>
        <Body style={{ fontWeight: '600' }}>{driver.name ?? 'Driver'}</Body>
        <Body muted>{formatKm(option.pickupKm)} away</Body>
      </View>
      <Body muted>{[driver.vehicleMake, driver.vehiclePlate].filter(Boolean).join(' · ')}</Body>
      <Body>{MATCH_LABELS[option.matchType]}{option.destinationAddress ? ` (heading to ${option.destinationAddress})` : ''}</Body>
      <Body muted>{describeDropoff(option)}</Body>
      <Body style={{ fontWeight: '600' }}>{describeFare(fare)}</Body>
      <Body muted>{option.seatsLeft} {option.seatsLeft === 1 ? 'seat' : 'seats'} free</Body>
    </Card>
  );
}
