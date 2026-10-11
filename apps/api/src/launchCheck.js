// What's missing or unsafe before the API runs for real users. server.js refuses to start in
// production while there are errors, and prints the warnings.

const PUBLIC_OSRM = 'router.project-osrm.org';
const PUBLIC_PHOTON = 'photon.komoot.io';

/** CORS_ORIGIN as cors and Socket.io take it: '*' when unset, else one or more comma-separated origins. */
export function parseOrigins(value) {
  const list = (value ?? '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  if (list.length === 0 || list.includes('*')) return '*';
  return list.length === 1 ? list[0] : list;
}

/** { errors, warnings } for the environment, in plain words with the setting to change. */
export function launchProblems(env) {
  const errors = [];
  const warnings = [];
  const missing = (keys) => keys.filter((k) => !env[k]);

  const secret = env.JWT_SECRET ?? '';
  if (secret.length < 32 || /change-me/.test(secret)) {
    errors.push('JWT_SECRET must be a long random secret (at least 32 characters), e.g. `openssl rand -hex 32`');
  }
  if (!env.DATABASE_URL) errors.push('DATABASE_URL must point at the production database');

  if ((env.SMS_PROVIDER ?? 'console') !== 'twilio') {
    errors.push('SMS_PROVIDER must be twilio, otherwise sign-in codes are only printed in the server log');
  } else if (missing(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']).length) {
    errors.push(`Twilio needs ${missing(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']).join(' and ')}`);
  }

  if (!env.PUBLIC_URL || !env.PUBLIC_URL.startsWith('https://')) {
    errors.push('PUBLIC_URL must be the API\'s https:// address (payment pages and shared trip links use it)');
  }

  const payments = missing(['PAYSTACK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
  if (payments.length) errors.push(`Payments need ${payments.join(', ')}`);
  if (/^sk_test_/.test(env.PAYSTACK_SECRET_KEY ?? '') || /^sk_test_/.test(env.STRIPE_SECRET_KEY ?? '')) {
    warnings.push('Paystack or Stripe is using a test key: no real money will move');
  }

  if (!env.S3_BUCKET) errors.push('S3_BUCKET (and its access keys) must be set to store driver documents');
  else if (missing(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']).length) {
    warnings.push('S3_BUCKET is set without AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY; that only works with a cloud role');
  }

  if (parseOrigins(env.CORS_ORIGIN) === '*') {
    warnings.push('CORS_ORIGIN is open to every website; set it to the web app and admin dashboard addresses');
  }
  if (env.ROUTING_PROVIDER === 'straight') errors.push('ROUTING_PROVIDER=straight is for testing; use osrm');
  else if ((env.OSRM_URL ?? PUBLIC_OSRM).includes(PUBLIC_OSRM)) {
    warnings.push('OSRM_URL is the public demo server, which has no uptime promise and a strict usage limit; run your own');
  }
  if ((env.GEOCODER_URL ?? PUBLIC_PHOTON).includes(PUBLIC_PHOTON)) {
    warnings.push('GEOCODER_URL is the public Photon server, which is for light use only; run your own or use a paid one');
  }
  if (env.PUSH_NOTIFICATIONS === 'off') warnings.push('PUSH_NOTIFICATIONS is off: closed apps get no ride requests');

  return { errors, warnings };
}
