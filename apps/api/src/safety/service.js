import { randomBytes } from 'node:crypto';
import { MAX_RATING_COMMENT, MAX_REPORT_DETAILS, REPORT_CATEGORIES } from '@pick/shared';

export class SafetyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ACTIVE = ['accepted', 'arrived', 'in_progress'];
const SHAREABLE = ['requested', ...ACTIVE];

/**
 * Ratings after a trip, a link riders can send to someone to follow their trip,
 * and problem reports for admins to follow up.
 */
export function createSafety({ repo, trips, drivers, publicUrl }) {
  /** The trip if this person rode or drove it, and who the other person was. */
  const tripOf = async (user, tripId) => {
    const trip = await trips.findById(tripId);
    if (!trip || (trip.riderId !== user.id && trip.driverId !== user.id)) throw new SafetyError(404, 'Trip not found');
    return { trip, other: trip.riderId === user.id ? trip.driverId : trip.riderId };
  };

  return {
    /** { stars: 1-5, comment? } for the other person on a completed trip. */
    async rate(user, tripId, { stars, comment }) {
      const { trip, other } = await tripOf(user, tripId);
      if (trip.status !== 'completed') throw new SafetyError(409, 'You can rate a trip once it has finished');
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new SafetyError(400, 'Choose from 1 to 5 stars');
      const text = typeof comment === 'string' ? comment.trim() : '';
      if (comment != null && typeof comment !== 'string') throw new SafetyError(400, 'comment must be text');
      if (text.length > MAX_RATING_COMMENT) throw new SafetyError(400, `Keep the comment under ${MAX_RATING_COMMENT} characters`);
      const rating = await repo.addRating({ tripId, fromUser: user.id, toUser: other, stars, comment: text || null });
      if (!rating) throw new SafetyError(409, 'You already rated this trip');
      return rating;
    },

    /** The rating this person gave on this trip, or null. */
    async myRating(user, tripId) {
      await tripOf(user, tripId);
      return repo.findRating(tripId, user.id);
    },

    ratingFor: (userId) => repo.ratingFor(userId),

    /** A link the rider can send to someone, who can then follow the trip in a browser until it ends. */
    async share(user, tripId) {
      const { trip } = await tripOf(user, tripId);
      if (trip.riderId !== user.id) throw new SafetyError(403, 'Only the passenger can share their trip');
      if (!SHAREABLE.includes(trip.status)) throw new SafetyError(409, 'This trip has ended');
      const token = randomBytes(18).toString('base64url');
      await repo.addShare({ token, tripId });
      return { url: `${publicUrl}/share/${token}` };
    },

    /** What someone with the link sees. Null for an unknown link. Nothing about the trip once it has ended. */
    async shared(token) {
      const tripId = typeof token === 'string' && token.length <= 64 ? await repo.tripForShare(token) : null;
      const trip = tripId && (await trips.findById(tripId));
      if (!trip) return null;
      if (!SHAREABLE.includes(trip.status)) return { status: trip.status, ended: true };
      const driver = trip.driverId ? await drivers.findById(trip.driverId) : null;
      return {
        status: trip.status,
        ended: false,
        pickupAddress: trip.pickupAddress,
        dropoffAddress: trip.dropoffAddress,
        driver: driver && {
          name: driver.name, vehicleMake: driver.vehicleMake, vehiclePlate: driver.vehiclePlate,
          location: ACTIVE.includes(trip.status) ? driver.location : null,
        },
      };
    },

    /** { category, details? } about a trip this person was on. Goes to admins. */
    async report(user, tripId, { category, details }) {
      const { other } = await tripOf(user, tripId);
      if (!REPORT_CATEGORIES.some((c) => c.code === category)) throw new SafetyError(400, 'Choose what went wrong');
      if (details != null && typeof details !== 'string') throw new SafetyError(400, 'details must be text');
      const text = details?.trim() ?? '';
      if (text.length > MAX_REPORT_DETAILS) throw new SafetyError(400, `Keep it under ${MAX_REPORT_DETAILS} characters`);
      return repo.addReport({ tripId, reporterId: user.id, aboutUserId: other, category, details: text || null });
    },

    listReports: (filters) => repo.listReports(filters),

    async resolveReport(admin, id, { note }) {
      if (note != null && (typeof note !== 'string' || note.length > 1000)) throw new SafetyError(400, 'note must be text up to 1000 characters');
      const report = await repo.resolveReport(id, { by: admin.id, note: note?.trim() || null });
      if (report) return report;
      throw (await repo.findReport(id))
        ? new SafetyError(409, 'This report is already resolved')
        : new SafetyError(404, 'Report not found');
    },
  };
}
