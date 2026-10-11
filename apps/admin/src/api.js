// Talks to the Pick API's admin endpoints. Every call returns the parsed body or throws an ApiError.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApi({ baseUrl, getToken, fetchFn = (...args) => fetch(...args) }) {
  async function call(method, path, body) {
    const token = getToken?.();
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
      throw new ApiError(0, `Can't reach the Pick API at ${baseUrl}`);
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong');
    return data;
  }

  const query = (params) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]),
    ).toString();
    return q ? `?${q}` : '';
  };

  return {
    requestCode: (phone) => call('POST', '/auth/code', { phone }),
    verify: (phone, code) => call('POST', '/auth/verify', { phone, code }),
    me: () => call('GET', '/auth/me'),
    overview: ({ days, country }) => call('GET', `/admin/overview${query({ days, country })}`),
    drivers: ({ status, q, country }) => call('GET', `/admin/drivers${query({ status, q, country })}`),
    setApproval: (driverId, approved) => call('POST', `/admin/drivers/${driverId}/approval`, { approved }),
    trips: ({ status, country, before }) => call('GET', `/admin/trips${query({ status, country, before })}`),
    balances: ({ country }) => call('GET', `/admin/balances${query({ country })}`),
    settlements: ({ driverId } = {}) => call('GET', `/admin/settlements${query({ driverId })}`),
    recordSettlement: (s) => call('POST', '/admin/settlements', s),
    payouts: ({ status, country } = {}) => call('GET', `/admin/payouts${query({ status, country })}`),
    payDriver: (driverId) => call('POST', `/admin/drivers/${driverId}/payout`),
    driverDocuments: (driverId) => call('GET', `/admin/drivers/${driverId}/documents`),
    reviewDocument: (id, status, reason) => call('POST', `/admin/documents/${id}/review`, { status, reason }),
    /** The uploaded file as a Blob (it needs the sign-in header, so it can't be a plain link). */
    async documentFile(id) {
      const res = await fetchFn(`${baseUrl}/admin/documents/${id}/file`, {
        headers: { Authorization: `Bearer ${getToken?.()}` },
      });
      if (!res.ok) throw new ApiError(res.status, 'Could not load the document');
      return res.blob();
    },
  };
}
