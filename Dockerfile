FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Server runs migrations in the background after listening so healthcheck
# returns quickly. Override with SKIP_MIGRATIONS=1 if migrating elsewhere.
CMD ["node", "server/index.js"]
