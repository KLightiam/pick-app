import { Server } from 'socket.io';
import { isValidPoint } from '@pick/shared';
import { db } from '../db/pool.js';

// Live channel: drivers stream their location, riders watch a trip's room.
// Sign-in (step 2) will replace the client-supplied driverId with a verified one.
export function attachRealtime(httpServer, { corsOrigin }) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin } });

  io.on('connection', (socket) => {
    socket.on('driver:location', async ({ driverId, lat, lng, tripId } = {}) => {
      if (!driverId || !isValidPoint({ lat, lng })) return;
      try {
        await db().query(
          `UPDATE drivers SET location = ST_MakePoint($2, $3)::geography, location_at = now()
            WHERE user_id = $1`,
          [driverId, lng, lat],
        );
      } catch (err) {
        console.error('driver:location', err.message);
      }
      if (tripId) io.to(`trip:${tripId}`).emit('trip:driver_location', { lat, lng });
    });

    socket.on('trip:watch', ({ tripId } = {}) => {
      if (tripId) socket.join(`trip:${tripId}`);
    });
  });

  return io;
}
