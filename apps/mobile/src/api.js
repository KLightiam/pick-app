// Talks to the Pick API. Every call returns the parsed JSON body or throws an ApiError.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// showAddress (development builds) names the address that failed, so a wrong EXPO_PUBLIC_API_URL is easy to spot.
export function createApi({ baseUrl, getToken, fetchFn = (...args) => fetch(...args), showAddress = false }) {
  // `raw` sends a file as-is: { body, contentType }.
  async function call(method, path, body, raw) {
    const token = await getToken?.();
    let res;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(raw && { 'Content-Type': raw.contentType }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: raw ? raw.body : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, showAddress
        ? `Can't reach the Pick API at ${baseUrl}. Is it running, and can this device reach that address?`
        : "Can't reach Pick. Check your internet connection.");
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
    deleteAccount: () => call('DELETE', '/auth/me'),
    registerPushToken: (token, platform) => call('PUT', '/auth/push-token', { token, platform }),
    unregisterPushToken: (token) => call('DELETE', '/auth/push-token', { token }),

    // Places
    searchPlaces: (q, near) => call('GET', `/places/search?${query({ q, lat: near?.lat, lng: near?.lng })}`),

    // Riders
    rideOptions: (ride) => call('POST', '/trips/options', ride),
    book: (ride) => call('POST', '/trips', ride),

    // Trips (riders and drivers)
    activeTrips: () => call('GET', '/trips/active'),
    openOffers: () => call('GET', '/trips/offers'),
    trip: (id) => call('GET', `/trips/${id}`),
    cancel: (id, reason) => call('POST', `/trips/${id}/cancel`, { reason }),
    payment: (id) => call('GET', `/trips/${id}/payment`),
    pay: (id) => call('POST', `/trips/${id}/pay`),
    unpaid: () => call('GET', '/payments/unpaid'),
    accept: (id) => call('POST', `/trips/${id}/accept`),
    arrived: (id) => call('POST', `/trips/${id}/arrived`),
    start: (id) => call('POST', `/trips/${id}/start`),
    complete: (id) => call('POST', `/trips/${id}/complete`),

    // Safety
    myRating: (id) => call('GET', `/trips/${id}/rating`),
    rateTrip: (id, stars, comment) => call('POST', `/trips/${id}/rating`, { stars, comment }),
    shareTrip: (id) => call('POST', `/trips/${id}/share`),
    reportProblem: (id, category, details) => call('POST', `/trips/${id}/reports`, { category, details }),

    // Drivers
    driverProfile: () => call('GET', '/drivers/me'),
    updateVehicle: (vehicle) => call('PUT', '/drivers/me/vehicle', vehicle),
    setDriverStatus: (status) => call('POST', '/drivers/me/status', status),
    earnings: (days = 7) => call('GET', `/drivers/me/earnings?days=${days}`),
    documents: () => call('GET', '/drivers/me/documents'),
    uploadDocument: (kind, file, contentType) => call('PUT', `/drivers/me/documents/${kind}`, undefined, { body: file, contentType }),
    payouts: () => call('GET', '/drivers/me/payouts'),
    setupPayouts: (details) => call('PUT', '/drivers/me/payout-account', details),
  };
}
