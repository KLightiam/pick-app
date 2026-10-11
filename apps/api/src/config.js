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
  geocoderUrl: process.env.GEOCODER_URL ?? 'https://photon.komoot.io',
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'console', // 'console' | 'twilio'
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioFrom: process.env.TWILIO_FROM ?? 'Pick',
  },
};
