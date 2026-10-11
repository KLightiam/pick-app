import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { api } from '../../api-instance.js';
import { Screen } from '../../ui.js';
import PlanRide from './PlanRide.js';
import RiderTrip from './RiderTrip.js';

/** Plans a ride, or shows the ride in progress (also after the app reopens mid-trip). */
export default function RiderHome({ user, live }) {
  const [booking, setBooking] = useState(undefined); // undefined while checking for an active trip
  const [start, setStart] = useState(null);

  // Pick up a trip in progress, or a finished ride that still needs paying.
  useEffect(() => {
    (async () => {
      try {
        const { trips } = await api.activeTrips();
        if (trips[0]) return setBooking({ trip: trips[0] });
        const { payment, trip } = await api.unpaid();
        setBooking(payment ? { trip, payment } : null);
      } catch {
        setBooking(null);
      }
    })();
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
  return <PlanRide key={start ? 'next-leg' : 'new'} country={user.country} start={start} onBooked={setBooking} />;
}
