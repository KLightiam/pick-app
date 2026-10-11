import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { api } from '../../api-instance.js';
import { Body, Button, Screen } from '../../ui.js';
import Driving from './Driving.js';
import GoOnline from './GoOnline.js';
import VehicleForm from './VehicleForm.js';

/** The driver's side of the app: car details, going online, and driving. */
export default function DriverHome({ live }) {
  const [driver, setDriver] = useState(null);
  const [status, setStatus] = useState(null); // set while online
  const [editingCar, setEditingCar] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    try {
      const { driver: profile } = await api.driverProfile();
      setDriver(profile);
      if (profile.online) {
        setStatus({ mode: profile.mode, seatsOffered: profile.seatsOffered, destinationAddress: profile.destinationAddress });
      }
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, []);

  if (error) {
    return <Screen><Body>{error}</Body><Button title="Try again" onPress={load} /></Screen>;
  }
  if (!driver) return <Screen><ActivityIndicator /></Screen>;

  if (editingCar || !driver.vehiclePlate) {
    return (
      <VehicleForm
        driver={driver}
        onSaved={(saved) => { setDriver(saved); setEditingCar(false); }}
        onCancel={driver.vehiclePlate ? () => setEditingCar(false) : undefined}
      />
    );
  }
  if (status) {
    return (
      <Driving
        driver={driver}
        status={status}
        live={live}
        onOffline={() => { setStatus(null); load(); }}
      />
    );
  }
  return (
    <GoOnline
      driver={driver}
      onOnline={(s) => { setStatus(s); load(); }}
      onEditCar={() => setEditingCar(true)}
    />
  );
}
