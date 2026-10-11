// Ratings and problem reports, shared by the API, the app and the dashboard.

/** What a rider or driver can report about a trip, most urgent first. */
export const REPORT_CATEGORIES = Object.freeze([
  Object.freeze({ code: 'safety', label: 'I felt unsafe' }),
  Object.freeze({ code: 'behaviour', label: 'Rude or unpleasant behaviour' }),
  Object.freeze({ code: 'driving', label: 'Dangerous driving' }),
  Object.freeze({ code: 'payment', label: 'A problem with the fare or payment' }),
  Object.freeze({ code: 'lost_item', label: 'I left something in the car' }),
  Object.freeze({ code: 'other', label: 'Something else' }),
]);

export const MAX_RATING_COMMENT = 500;
export const MAX_REPORT_DETAILS = 2000;

/** { average, count } from a list of star ratings (1 to 5), average to one decimal; null with no ratings. */
export function ratingSummary(stars) {
  if (!stars.length) return null;
  const average = Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10;
  return { average, count: stars.length };
}
