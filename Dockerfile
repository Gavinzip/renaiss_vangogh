FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY scripts/prepare-docker-web-package.mjs ./scripts/prepare-docker-web-package.mjs
RUN node scripts/prepare-docker-web-package.mjs
RUN npm install --include=dev --no-audit --no-fund --package-lock=false

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache git

ENV NODE_ENV=production
ENV PORT=3000
ENV LUCKY_DRAW_DATA_DIR=/data/lucky-draw
ENV LUCKY_DRAW_CACHE_DIR=/data/lucky-draw/cache
ENV LUCKY_DRAW_LEDGER_PATH=/data/lucky-draw/lucky-draw-ledger.json
ENV LUCKY_DRAW_REFRESH_MINUTES=60
ENV DATA_BACKUP_REPO_URL=https://github.com/Gavinzip/renaiss_vangogh_data.git
ENV DATA_BACKUP_INTERVAL_MINUTES=60

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY scripts ./scripts

EXPOSE 3000
CMD ["npm", "run", "start"]
