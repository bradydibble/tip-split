FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /app/data
EXPOSE 3000
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/tipsplit.db
CMD ["node", "build"]
