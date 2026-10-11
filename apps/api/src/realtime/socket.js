import { Server } from 'socket.io';
import { isValidPoint } from '@pick/shared';
import { db } from '../db/pool.js';

// Live channel: drivers stream their location, riders watch their trip's room.
// Every connection must carry a sign-in token: io(url, { auth: { token } }).
export function attachRealtime(httpServer, { corsOrigin, tokens }) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin } });

  io.use((socket, next) => {
    const user = tokens.verify(socket.handshake.auth?.token);
    if (!user) return next(new Error('sign in required'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    socket.join(`user:${user.id}`); // for events sent to this user, see notifier.js

    socket.on('driver:location', async ({ lat, lng, tripId } = {}) => {
      if (user.role !== 'driver' || !isValidPoint({ lat, lng })) return;
      try {
        await db().query(
          `UPDATE drivers SET location = ST_MakePoint($2, $3)::geography, location_at = now()
            WHERE user_id = $1`,
          [user.id, lng, lat],
        );
        if (tripId) {
          const { rowCount } = await db().query(
            'SELECT 1 FROM trips WHERE id = $1 AND driver_id = $2', [tripId, user.id],
          );
          if (rowCount) io.to(`trip:${tripId}`).emit('trip:driver_location', { lat, lng });
        }
      } catch (err) {
        console.error('driver:location', err.message);
      }
    });

    socket.on('trip:watch', async ({ tripId } = {}) => {
      if (!tripId) return;
      try {
        const { rowCount } = await db().query(
          'SELECT 1 FROM trips WHERE id = $1 AND (rider_id = $2 OR driver_id = $2)', [tripId, user.id],
        );
        if (rowCount) socket.join(`trip:${tripId}`);
      } catch (err) {
        console.error('trip:watch', err.message);
      }
    });
  });

  return io;
}
