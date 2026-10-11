import { useState } from 'react';
import { api } from '../../api-instance.js';
import { Body, Button, ErrorText, Field, Screen, Stepper, Title } from '../../ui.js';

/** The driver's car: make, plate and how many passenger seats it has. */
export default function VehicleForm({ driver, onSaved, onCancel }) {
  const [vehicleMake, setMake] = useState(driver.vehicleMake ?? '');
  const [vehiclePlate, setPlate] = useState(driver.vehiclePlate ?? '');
  const [seats, setSeats] = useState(driver.seats ?? 4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { driver: saved } = await api.updateVehicle({
        vehicleMake: vehicleMake.trim() || null, vehiclePlate: vehiclePlate.trim() || null, seats,
      });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Your car</Title>
      <Body muted>Passengers see this when they choose a driver.</Body>
      <Field label="Make and model" placeholder="Toyota Corolla" value={vehicleMake} onChangeText={setMake} />
      <Field label="Number plate" placeholder="GR 1234-24" autoCapitalize="characters" value={vehiclePlate} onChangeText={setPlate} />
      <Stepper label="Passenger seats" value={seats} min={1} max={8} onChange={setSeats} />
      <Button title="Save" onPress={save} busy={busy} disabled={!vehiclePlate.trim()} />
      {onCancel && <Button title="Back" variant="secondary" onPress={onCancel} />}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
