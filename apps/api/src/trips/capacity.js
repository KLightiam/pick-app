/**
 * Whether a driver has room for a booking.
 * load: { bookings, seatsUsed, hasSolo } for the driver's active trips.
 * - A solo booking takes the whole car, so the car must be empty.
 * - A shared booking needs no solo passenger aboard and enough of the seats the driver chose to share.
 */
export function hasRoom(driver, load, { rideType, seats }) {
  if (rideType === 'solo') return load.bookings === 0 && seats <= driver.seats;
  return !load.hasSolo && load.seatsUsed + seats <= driver.seatsOffered;
}

export function seatsLeft(driver, load) {
  return load.hasSolo ? 0 : Math.max(0, driver.seatsOffered - load.seatsUsed);
}
