export const TRIP_STATUS = Object.freeze({
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

/** Statuses in which a trip still ties up its rider (and driver, once assigned). */
export const ACTIVE_TRIP_STATUSES = Object.freeze(['requested', 'accepted', 'arrived', 'in_progress']);

// Which status each status may move to next.
const NEXT = {
  requested: ['accepted', 'cancelled'],
  accepted: ['arrived', 'cancelled'],
  arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

export function canTransition(from, to) {
  return (NEXT[from] ?? []).includes(to);
}
