import http from 'node:http';
import { createApp } from './app.js';
import { attachRealtime } from './realtime/socket.js';
import { config } from './config.js';
import { db } from './db/pool.js';
import { createOtpService } from './auth/otp.js';
import { pgOtpStore } from './auth/otpStore.js';
import { createTokens } from './auth/tokens.js';
import { pgUsersRepo } from './users/repo.js';
import { createSms } from './sms/index.js';

const tokens = createTokens({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
const deps = {
  tokens,
  users: pgUsersRepo(db),
  otp: createOtpService({ store: pgOtpStore(db), sms: createSms(config.sms), secret: config.jwtSecret }),
};

const server = http.createServer(createApp({ corsOrigin: config.corsOrigin, deps }));
attachRealtime(server, { corsOrigin: config.corsOrigin, tokens });

server.listen(config.port, () => {
  console.log(`Pick API listening on http://localhost:${config.port}`);
});
