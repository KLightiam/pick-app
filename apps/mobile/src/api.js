// Talks to the Pick API. Every call returns the parsed JSON body or throws an ApiError.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApi({ baseUrl, getToken, fetchFn = (...args) => fetch(...args) }) {
  async function call(method, path, body) {
    const token = await getToken?.();
    let res;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "Can't reach Pick. Check your internet connection.");
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong. Please try again.');
    return data;
  }

  const query = (params) => new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
  ).toString();

  return {
    // Sign-in
    requestCode: (phone) => call('POST', '/auth/code', { phone }),
    verify: ({ phone, code, role, name }) => call('POST', '/auth/verify', { phone, code, role, name }),
    me: () => call('GET', '/auth/me'),

    // Places
    searchPlaces: (q, near) => call('GET', `/places/search?${query({ q, lat: near?.lat, lng: near?.lng })}`),

    // Riders
    rideOptions: (ride) => call('POST', '/trips/options', ride),
    book: (ride) => call('POST', '/trips', ride),

    // Trips (riders and drivers)
    activeTrips: () => call('GET', '/trips/active'),
    trip: (id) => call('GET', `/trips/${id}`),
    cancel: (id, reason) => call('POST', `/trips/${id}/cancel`, { reason }),
    accept: (id) => call('POST', `/trips/${id}/accept`),
    arrived: (id) => call('POST', `/trips/${id}/arrived`),
    start: (id) => call('POST', `/trips/${id}/start`),
    complete: (id) => call('POST', `/trips/${id}/complete`),

    // Drivers
    driverProfile: () => call('GET', '/drivers/me'),
    updateVehicle: (vehicle) => call('PUT', '/drivers/me/vehicle', vehicle),
    setDriverStatus: (status) => call('POST', '/drivers/me/status', status),
  };
}
