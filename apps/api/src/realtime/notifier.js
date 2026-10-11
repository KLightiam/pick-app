// Pushes events to a user's connected devices. Each socket joins `user:<id>` on connect.
export function socketNotifier(io) {
  return {
    toUser(userId, event, payload) {
      io.to(`user:${userId}`).emit(event, payload);
    },
  };
}
