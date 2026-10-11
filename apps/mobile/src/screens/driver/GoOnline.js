import { useState } from 'react';
import { ScrollView } from 'react-native';
import { api } from '../../api-instance.js';
import PlaceSearch from '../../components/PlaceSearch.js';
import { getCurrentLocation } from '../../location.js';
import { Body, Button, Choice, ErrorText, Stepper, Title } from '../../ui.js';

const MODES = [
  { value: 'commute', label: "I'm heading somewhere" },
  { value: 'anywhere', label: 'Go anywhere' },
];

/** Choose commute (with a destination) or go-anywhere, and how many seats to share. */
export default function GoOnline({ driver, onOnline, onEditCar }) {
  const [mode, setMode] = useState(driver.mode ?? 'commute');
  const [destination, setDestination] = useState(null);
  const [seatsOffered, setSeatsOffered] = useState(Math.min(driver.seatsOffered ?? 1, driver.seats));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const goOnline = async () => {
    setBusy(true);
    setError(null);
    try {
      const location = await getCurrentLocation();
      const status = await api.setDriverStatus({
        online: true,
        location,
        mode,
        seatsOffered,
        ...(mode === 'commute' && {
          destination: destination.location,
          destinationAddress: destination.address ?? destination.name,
        }),
      });
      onOnline(status);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Title>Ready to drive?</Title>
      {!driver.approved && (
        <Body>Your driver account is waiting for approval. You can go online once Pick has checked your details.</Body>
      )}
      <Choice options={MODES} value={mode} onChange={setMode} />
      <Body muted>
        {mode === 'commute'
          ? "Pick passengers going your way. They pay less, and you don't leave your route."
          : 'Take passengers wherever they want to go, like a taxi.'}
      </Body>
      {mode === 'commute' && (
        <PlaceSearch label="Where are you heading?" placeholder="Search a place" value={destination} onChange={setDestination} />
      )}
      <Stepper label="Seats to share" value={seatsOffered} min={1} max={driver.seats} onChange={setSeatsOffered} />
      <Body muted>
        {seatsOffered === 1
          ? 'One booking at a time.'
          : `Up to ${seatsOffered} passengers can share your car. A solo booking still gets the car to themselves.`}
      </Body>
      <Button
        title="Go online"
        onPress={goOnline}
        busy={busy}
        disabled={!driver.approved || (mode === 'commute' && !destination)}
      />
      <Button title={`Your car: ${[driver.vehicleMake, driver.vehiclePlate].filter(Boolean).join(' · ') || 'add details'}`} variant="secondary" onPress={onEditCar} />
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
