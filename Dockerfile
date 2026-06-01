FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV LUCKY_DRAW_DATA_DIR=/Data/lucky-draw
ENV LUCKY_DRAW_CACHE_DIR=/Data/lucky-draw/cache
ENV LUCKY_DRAW_LEDGER_PATH=/Data/lucky-draw/lucky-draw-ledger.json
ENV LUCKY_DRAW_REFRESH_MINUTES=60

EXPOSE 3000
CMD ["npm", "run", "start"]
