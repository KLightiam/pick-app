import http from 'node:http';
import { createApp } from './app.js';
import { attachRealtime } from './realtime/socket.js';
import { socketNotifier } from './realtime/notifier.js';
import { config } from './config.js';
import { db } from './db/pool.js';
import { createOtpService } from './auth/otp.js';
import { pgOtpStore } from './auth/otpStore.js';
import { createTokens } from './auth/tokens.js';
import { pgUsersRepo } from './users/repo.js';
import { pgDriversRepo } from './drivers/repo.js';
import { pgTripsRepo } from './trips/repo.js';
import { createDispatch } from './trips/dispatch.js';
import { createSms } from './sms/index.js';

const server = http.createServer();
const tokens = createTokens({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
const io = attachRealtime(server, { corsOrigin: config.corsOrigin, tokens });

const users = pgUsersRepo(db);
const drivers = pgDriversRepo(db);
const trips = pgTripsRepo(db);
const deps = {
  tokens,
  users,
  drivers,
  trips,
  otp: createOtpService({ store: pgOtpStore(db), sms: createSms(config.sms), secret: config.jwtSecret }),
  dispatch: createDispatch({ trips, drivers, users, notifier: socketNotifier(io) }),
};

server.on('request', createApp({ corsOrigin: config.corsOrigin, deps }));
server.listen(config.port, () => {
  console.log(`Pick API listening on http://localhost:${config.port}`);
});
