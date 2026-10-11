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
import { createRouting } from './routing/index.js';
import { createRouteKeeper } from './drivers/routeKeeper.js';
import { createGeocoder } from './places/index.js';
import { pgPaymentsRepo } from './payments/repo.js';
import { createPaymentProviders } from './payments/providers.js';
import { createPayments } from './payments/service.js';
import { pgAdminRepo } from './admin/repo.js';

const server = http.createServer();
const tokens = createTokens({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
const users = pgUsersRepo(db);
const drivers = pgDriversRepo(db);
const trips = pgTripsRepo(db);
const routing = createRouting(config.routing);
const routeKeeper = createRouteKeeper({ drivers, routing });
const io = attachRealtime(server, { corsOrigin: config.corsOrigin, tokens, drivers, routeKeeper });
const notifier = socketNotifier(io);
const providers = createPaymentProviders({ ...config.payments, publicUrl: config.publicUrl, isProduction: config.isProduction });
const payments = createPayments({
  repo: pgPaymentsRepo(db), providers, notifier, publicUrl: config.publicUrl, emailDomain: config.payments.emailDomain,
});
const deps = {
  tokens,
  users,
  drivers,
  trips,
  routing,
  geocoder: createGeocoder({ url: config.geocoderUrl }),
  otp: createOtpService({ store: pgOtpStore(db), sms: createSms(config.sms), secret: config.jwtSecret }),
  payments,
  admin: pgAdminRepo(db),
  testCheckout: [providers.paystack, providers.stripe].includes(providers.test) ? providers.test : null,
  dispatch: createDispatch({ trips, drivers, users, payments, notifier }),
};

server.on('request', createApp({ corsOrigin: config.corsOrigin, deps }));
server.listen(config.port, () => {
  console.log(`Pick API listening on http://localhost:${config.port}`);
});
