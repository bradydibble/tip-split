FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app

COPY --from=build /app/build ./build
COPY --from=build /app/package*.json ./

RUN npm ci --omit=dev && npm rebuild better-sqlite3

RUN mkdir -p /app/data

EXPOSE 3000
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/tipsplit.db

CMD ["node", "build"]
