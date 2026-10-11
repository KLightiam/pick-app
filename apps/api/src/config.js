export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://pick:pick@localhost:5432/pick',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
