import * as Location from 'expo-location';

async function ensurePermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Pick needs your location to find rides near you.');
}

/** The phone's current position as { lat, lng }. */
export async function getCurrentLocation() {
  await ensurePermission();
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: coords.latitude, lng: coords.longitude };
}

/** Calls onMove({ lat, lng }) as the driver moves. Returns a function that stops watching. */
export async function watchLocation(onMove) {
  await ensurePermission();
  const sub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 50, timeInterval: 10_000 },
    ({ coords }) => onMove({ lat: coords.latitude, lng: coords.longitude }),
  );
  return () => sub.remove();
}
