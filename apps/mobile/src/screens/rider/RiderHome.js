import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { api } from '../../api-instance.js';
import { Screen } from '../../ui.js';
import PlanRide from './PlanRide.js';
import RiderTrip from './RiderTrip.js';

/** Plans a ride, or shows the ride in progress (also after the app reopens mid-trip). */
export default function RiderHome({ live }) {
  const [booking, setBooking] = useState(undefined); // undefined while checking for an active trip
  const [start, setStart] = useState(null);

  useEffect(() => {
    api.activeTrips()
      .then(({ trips }) => setBooking(trips[0] ? { trip: trips[0] } : null))
      .catch(() => setBooking(null));
  }, []);

  if (booking === undefined) return <Screen><ActivityIndicator /></Screen>;
  if (booking) {
    return (
      <RiderTrip
        key={booking.trip.id}
        booking={booking}
        live={live}
        onDone={({ nextLeg }) => {
          setStart(nextLeg && {
            pickup: { name: 'Where the driver dropped you', address: null, location: nextLeg.pickup, current: true },
            dropoff: { name: nextLeg.dropoffAddress ?? 'Your destination', address: nextLeg.dropoffAddress, location: nextLeg.dropoff },
          });
          setBooking(null);
        }}
      />
    );
  }
  return <PlanRide key={start ? 'next-leg' : 'new'} start={start} onBooked={setBooking} />;
}
