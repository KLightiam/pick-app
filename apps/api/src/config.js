const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://pick:pick@localhost:5432/pick',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  routing: {
    provider: process.env.ROUTING_PROVIDER ?? 'osrm', // 'osrm' | 'straight'
    osrmUrl: process.env.OSRM_URL ?? 'https://router.project-osrm.org',
  },
  // Where this API is reachable from riders' phones and from Paystack/Stripe (checkout return page, test checkout).
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  payments: {
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    // Paystack needs an email per payment; riders sign in by phone, so one is made up on this domain.
    emailDomain: process.env.PAYSTACK_EMAIL_DOMAIN ?? 'riders.pick.invalid',
  },
  // Driver documents: an S3-compatible bucket in production, a folder on disk in development.
  storage: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT, // for Cloudflare R2, MinIO and others; leave empty for AWS
    dir: process.env.UPLOADS_DIR ?? new URL('../uploads', import.meta.url).pathname,
  },
  geocoderUrl: process.env.GEOCODER_URL ?? 'https://photon.komoot.io',
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'console', // 'console' | 'twilio'
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioFrom: process.env.TWILIO_FROM ?? 'Pick',
  },
};
