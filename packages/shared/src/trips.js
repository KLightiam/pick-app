export const TRIP_STATUS = Object.freeze({
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

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
