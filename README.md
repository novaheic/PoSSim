# PoSSim — Proof of Stake classroom simulation

A small multiplayer web game that makes Ethereum-style **proof of stake** tangible for 4–15 students:

- **Random lobby** on first visit, with a **shareable URL** (`/lobby/ABC123`)
- Each player gets a **random ETH stake** (8–64 ETH)
- Every **30 seconds**: a quick **math attestation** (stay online = good validator)
- Every **2 minutes** (configurable): one player **proposes a block**, chosen **weighted by stake**
- **Balances, attestations, blocks, joins, and misses** show up in a live **network activity** feed

This is a teaching toy, not real crypto.

## Quick start (local classroom)

On the machine that hosts the session (your laptop or a free cloud app):

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`. You get a lobby code in the URL — share that link with the class. Everyone clicks **Enter lobby**, then the sim **auto-starts when 2+ people are connected** (or anyone can click **Start simulation**).

For development with hot reload:

```bash
npm install
npm run dev
```

Open `http://localhost:5173` (API/WebSocket proxy to port 3000).

### Same Wi‑Fi, no cloud

Find your LAN IP (e.g. `192.168.1.42`) and share `http://192.168.1.42:3000/lobby/XXXXXX`. Allow port 3000 through Windows Firewall if needed.

## Deploy for remote classes (GitHub → Render)

GitHub Pages only serves static files; this app needs a **WebSocket server**. A simple path:

1. Push this repo to GitHub.
2. [Render](https://render.com) → **New Web Service** → connect the repo.
3. Settings:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Environment:** `BLOCK_INTERVAL_MINUTES` = `2` (or `3` for a slower class)
4. Use the Render URL as your classroom link.

`render.yaml` in the repo is an optional blueprint for one-click setup on Render.

## How it maps to real PoS

| Simulation | Real Ethereum PoS idea |
|------------|-------------------------|
| Random starting stake | Validators deposit different amounts (32 ETH minimum on mainnet) |
| Math puzzle every 30s | **Attestations** — validators vote on the head of the chain on a schedule |
| Correct / on-time answer | Honest, available validator earns rewards |
| Wrong or missed answer | Small penalty (stand-in for **inactivity** / missed duty) |
| Block every N minutes | **Block proposal** slot |
| Winner weighted by ETH | **Random selection proportional to effective stake** |
| Activity feed | Block explorers & client logs making consensus visible |

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3000` | HTTP + WebSocket port |
| `BLOCK_INTERVAL_MINUTES` | `2` | Time between block proposals |

Rewards and penalties are in `server/lobby.js` (`DEFAULT_CONFIG`).

## Tech

- **Node.js** + **Express** + **ws** — lobby state and game loop
- **Vite** — static UI (no React, easy to hack in class)

## License

MIT — use freely in classrooms.
