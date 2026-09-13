FROM node:20-alpine AS base
WORKDIR /app

# better-sqlite3 needs build tools during install
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./
COPY public ./public

# Persistent volume for the SQLite database
VOLUME ["/data"]
ENV DB_PATH=/data/w-house.sqlite
ENV PORT=3000

EXPOSE 3000
CMD ["node", "server.js"]
