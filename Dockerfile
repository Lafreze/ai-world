FROM node:20-alpine
WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Run migrations then start
CMD ["sh", "-c", "node server/db/migrate.js && node server/index.js"]
