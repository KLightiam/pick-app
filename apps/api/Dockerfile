# The Pick API. Build from the repository root (it needs packages/shared and db/migrations):
#   docker build -f apps/api/Dockerfile -t pick-api .
FROM node:22-slim
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @pick/api...

COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY db/migrations db/migrations

ENV NODE_ENV=production PORT=4000
EXPOSE 4000
USER node
WORKDIR /app/apps/api
# New migrations run before the server starts; each runs once, in a transaction.
CMD ["sh", "-c", "node src/db/migrate.js && exec node src/server.js"]
