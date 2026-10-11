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
import { pgDocumentsRepo } from './documents/repo.js';
import { createStorage } from './documents/storage.js';
import { createDocuments } from './documents/service.js';
import { pgPayoutsRepo } from './payouts/repo.js';
import { createPayouts } from './payouts/service.js';

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
const paymentsRepo = pgPaymentsRepo(db);
const payments = createPayments({
  repo: paymentsRepo, providers, notifier, publicUrl: config.publicUrl, emailDomain: config.payments.emailDomain,
});
const payouts = createPayouts({ repo: pgPayoutsRepo(db), balances: paymentsRepo, providers, notifier, publicUrl: config.publicUrl });
const deps = {
  tokens,
  users,
  drivers,
  trips,
  routing,
  geocoder: createGeocoder({ url: config.geocoderUrl }),
  otp: createOtpService({ store: pgOtpStore(db), sms: createSms(config.sms), secret: config.jwtSecret }),
  payments,
  payouts,
  admin: pgAdminRepo(db),
  documents: createDocuments({
    repo: pgDocumentsRepo(db), storage: createStorage({ ...config.storage, isProduction: config.isProduction }),
  }),
  testCheckout: [providers.paystack, providers.stripe].includes(providers.test) ? providers.test : null,
  dispatch: createDispatch({ trips, drivers, users, payments, notifier }),
};

server.on('request', createApp({ corsOrigin: config.corsOrigin, deps }));
server.listen(config.port, () => {
  console.log(`Pick API listening on http://localhost:${config.port}`);
});

// Weekly payouts: checked every hour, each driver is paid once a week when owed the minimum.
if (config.payments.autoPayouts) {
  const run = () => payouts.runDue()
    .then((s) => { if (s.paid + s.pending + s.failed + s.checked > 0) console.log('payouts', s); })
    .catch((err) => console.error('payouts', err));
  setInterval(run, 60 * 60 * 1000).unref();
  setTimeout(run, 60 * 1000).unref();
}
