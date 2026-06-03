# Renaiss Lucky Draw Console

React control console for the lucky draw workflow:

- loads an official buyback ledger from `public/lucky-draw-ledger.json`
- refuses to open the draw console unless `public/lucky-draw-ledger.json` is present
- applies current published pack weights: OMEGA `1`, Costume Pack `2`
- applies SBT multipliers: Bronze `1.2`, Silver `1.5`, Gold `2`, Rainbow `3`
- connects to a BSC wallet and calls the BNB Smart Chain draw contract

## Important data rule

Open Monitor's lucky-draw page is a maximum possible estimate from pack pulls. It does not prove the user completed buyback for those pulls, so it is kept as an audit input only and is not used as the public draw ledger.

The production draw should use `public/lucky-draw-ledger.json`, generated from Renaiss buyback activities. Base tickets are ordered by buyback timestamp, block number, ordinal, transaction hash, then activity id. SBT bonus tickets are appended deterministically after the event-backed tickets.

If Open Monitor returns fields for packs not in the current published rules, the app warns about that conflict and does not count those packs in the official rule model.

## Commands

```bash
npm install
npm run dev
npm run start
npm run build
npm run lint
```

Generate a verified ledger:

```bash
npm run fetch:ledger
```

Quick dry run without writing output:

```bash
npm run fetch:ledger -- --dry-run
```

Production should scan BSC contract logs directly. Open Monitor remains an audit input only and is not the default ledger source.

The Open Monitor audit endpoint is routed through Vite's local proxy during `npm run dev` because the endpoint does not allow direct browser CORS from localhost. Production serves the generated ledger JSON from the server data directory instead of relying on that proxy.

## Production deployment

This repo is ready to deploy as a Node service. The production server serves the built React app from `dist` and serves `/lucky-draw-ledger.json` from a mounted data directory.

Required environment:

```bash
BSCSCAN_API_KEY=...
PORT=3000
LUCKY_DRAW_DATA_DIR=/data/lucky-draw
LUCKY_DRAW_CACHE_DIR=/data/lucky-draw/cache
LUCKY_DRAW_LEDGER_PATH=/data/lucky-draw/lucky-draw-ledger.json
LUCKY_DRAW_REFRESH_MINUTES=60
DATA_BACKUP_REPO_URL=https://github.com/Gavinzip/renaiss_vangogh_data.git
DATA_BACKUP_GITHUB_TOKEN=...
DATA_BACKUP_INTERVAL_MINUTES=60
```

`/data` must be a mounted persistent disk on the server. Do not point `LUCKY_DRAW_CACHE_DIR` inside the git repo in production.

Production commands:

```bash
npm ci
npm run build
npm run start
```

The server refreshes the ledger once at startup and then every hour. It writes API/cache files under `/data/lucky-draw/cache`, writes the public ledger to `/data/lucky-draw/lucky-draw-ledger.json`, and copies each successful ledger to `/data/lucky-draw/snapshots`.

When `DATA_BACKUP_GITHUB_TOKEN` is present, the server backs up `/data/lucky-draw` to `DATA_BACKUP_REPO_URL` every hour and after a successful ledger refresh. Use a fine-grained GitHub token with Contents read/write on only the backup repository.

Docker deployment uses the same defaults:

```bash
docker build -t renaiss-vangogh .
docker run --rm -p 3000:3000 \
  -e BSCSCAN_API_KEY=... \
  -e DATA_BACKUP_GITHUB_TOKEN=... \
  -v /data:/data \
  renaiss-vangogh
```

## Contract

`contracts/RenaissLuckyDraw.sol` is a BSC / Binance Oracle VRF draw contract:

- owner finalizes the ledger hash and total ticket count
- owner or draw operator requests randomness
- Binance Oracle VRF fulfills exactly once
- public reads stay open for verification

Local dry run:

```bash
npm run contract:compile
npm run contract:dry-run
```

BSC mainnet deployment wallet and preflight:

```bash
npm run wallet:create
npm run contract:deploy:check
```

After the deployer address has BNB for gas and Binance Oracle VRF subscription funding:

```bash
npm run contract:deploy:bsc
```

Binance Oracle VRF defaults used by the deploy script:

- BSC mainnet coordinator: `0x9632ADE542f12114f5E5AD4d6F8e47fB993955da`
- BSC mainnet keyHash: `0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4`
- BSC testnet coordinator: `0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053`
- BSC testnet keyHash: `0x617abc3f53ae11766071d04ada1c7b0fbd49833b9542e9e91da4d3191c70cc80`

The local secret is written to `.env.deploy.local`, which is ignored by `*.local`.
The currently deployed mainnet contract may still be the previous VRF provider until a new mainnet deployment is explicitly performed.
