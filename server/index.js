import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import {
  createLobby,
  randomLobbyId,
  randomPlayerName,
  randomStake,
  makePuzzle,
  pickBlockProposer,
  logAction,
  publicLobby,
  DEFAULT_CONFIG,
} from "./lobby.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const blockMinutes = Number(process.env.BLOCK_INTERVAL_MINUTES) || 2;
const lobbies = new Map();

function newLobby(id) {
  return createLobby(id, { blockIntervalMs: blockMinutes * 60_000 });
}

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/lobby", (_req, res) => {
  let id = randomLobbyId();
  while (lobbies.has(id)) id = randomLobbyId();
  const lobby = newLobby(id);
  lobbies.set(id, lobby);
  res.json({ id });
});

app.get("/api/lobby/:id", (req, res) => {
  const lobby = lobbies.get(req.params.id.toUpperCase());
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  res.json(publicLobby(lobby));
});

const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));

app.get(["/", "/lobby/:id"], (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(lobby) {
  const payload = JSON.stringify({ type: "state", lobby: publicLobby(lobby) });
  for (const p of lobby.players.values()) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(payload);
  }
}

function clearLobbyTimers(lobby) {
  if (lobby.timers.attestation) clearInterval(lobby.timers.attestation);
  if (lobby.timers.block) clearInterval(lobby.timers.block);
  lobby.timers.attestation = null;
  lobby.timers.block = null;
}

/** Penalize players who never submitted before the round ends (not wrong answers — those are handled on submit). */
function finalizeAttestation(lobby) {
  const att = lobby.attestation;
  if (!att || att.closed) return;
  att.closed = true;

  for (const p of lobby.players.values()) {
    if (!p.connected) continue;
    if (Object.prototype.hasOwnProperty.call(att.submitted, p.id)) continue;
    p.attestationsMiss += 1;
    p.balance = Math.max(0, roundEth(p.balance - lobby.config.attestationPenaltyEth));
    logAction(
      lobby,
      "slash",
      `${p.name} missed attestation #${lobby.attestationIndex} (−${lobby.config.attestationPenaltyEth} ETH)`,
      { playerId: p.id },
    );
  }
  lobby.attestation = null;
}

function startAttestationRound(lobby) {
  if (lobby.status !== "running") return;
  finalizeAttestation(lobby);
  lobby.attestationIndex += 1;
  const puzzle = makePuzzle();
  const endsAt = Date.now() + lobby.config.attestationIntervalMs;
  lobby.attestation = {
    id: crypto.randomUUID(),
    ...puzzle,
    endsAt,
    submitted: {},
    closed: false,
  };
  logAction(lobby, "attestation", `Attestation #${lobby.attestationIndex} started — answer within 30s`);
  broadcast(lobby);
}

function proposeBlock(lobby) {
  if (lobby.status !== "running") return;
  lobby.blockIndex += 1;
  const players = [...lobby.players.values()];
  const proposer = pickBlockProposer(players);
  if (!proposer) {
    logAction(lobby, "block", `Slot #${lobby.blockIndex}: no eligible validators`);
    broadcast(lobby);
    return;
  }
  proposer.blocksProposed += 1;
  proposer.balance = roundEth(proposer.balance + lobby.config.blockRewardEth);
  logAction(
    lobby,
    "block",
    `${proposer.name} proposed block #${lobby.blockIndex} (+${lobby.config.blockRewardEth} ETH) — selected by stake weight`,
    { playerId: proposer.id },
  );
  broadcast(lobby);
}

function roundEth(n) {
  return Math.round(n * 1000) / 1000;
}

function startSimulation(lobby) {
  if (lobby.status === "running") return;
  lobby.status = "running";
  lobby.startedAt = Date.now();
  logAction(lobby, "system", "Simulation started — attest every 30s, blocks every few minutes");
  startAttestationRound(lobby);
  lobby.timers.block = setInterval(() => proposeBlock(lobby), lobby.config.blockIntervalMs);
  lobby.timers.attestation = setInterval(
    () => startAttestationRound(lobby),
    lobby.config.attestationIntervalMs,
  );
  broadcast(lobby);
}

function maybeAutoStart(lobby) {
  const connected = [...lobby.players.values()].filter((p) => p.connected).length;
  if (lobby.status === "waiting" && connected >= 2) {
    startSimulation(lobby);
  }
}

function getOrCreateLobby(id) {
  const key = id.toUpperCase();
  let lobby = lobbies.get(key);
  if (!lobby) {
    lobby = newLobby(key);
    lobbies.set(key, lobby);
  }
  return lobby;
}

function handleJoin(ws, msg) {
  const lobby = getOrCreateLobby(msg.lobbyId);
  const playerId = msg.playerId || crypto.randomUUID();
  let player = lobby.players.get(playerId);

  const usedNames = new Set([...lobby.players.values()].map((p) => p.name));
  if (!player) {
    const cfg = lobby.config;
    player = {
      id: playerId,
      name: msg.name?.trim()?.slice(0, 20) || randomPlayerName(usedNames),
      balance: randomStake(cfg.minStakeEth, cfg.maxStakeEth),
      connected: true,
      ws,
      attestationsOk: 0,
      attestationsMiss: 0,
      blocksProposed: 0,
      lastAttestationAt: null,
    };
    lobby.players.set(playerId, player);
    logAction(
      lobby,
      "join",
      `${player.name} joined with ${player.balance} ETH stake`,
      { playerId: player.id },
    );
  } else {
    player.connected = true;
    player.ws = ws;
    if (msg.name?.trim()) player.name = msg.name.trim().slice(0, 20);
    logAction(lobby, "join", `${player.name} reconnected`, { playerId: player.id });
  }

  ws.lobbyId = lobby.id;
  ws.playerId = playerId;

  ws.send(
    JSON.stringify({
      type: "welcome",
      playerId,
      lobby: publicLobby(lobby),
    }),
  );
  broadcast(lobby);
  maybeAutoStart(lobby);
}

function handleAttestation(ws, msg) {
  const lobby = lobbies.get(ws.lobbyId);
  if (!lobby || !lobby.attestation || lobby.attestation.closed) return;
  const player = lobby.players.get(ws.playerId);
  if (!player) return;
  const att = lobby.attestation;
  if (Object.prototype.hasOwnProperty.call(att.submitted, player.id)) return;
  if (Date.now() > att.endsAt) return;

  const choice = Number(msg.choice);
  const ok = choice === att.answer;
  att.submitted[player.id] = ok;
  player.lastAttestationAt = Date.now();

  if (ok) {
    player.attestationsOk += 1;
    player.balance = roundEth(player.balance + lobby.config.attestationRewardEth);
    logAction(
      lobby,
      "attestation_ok",
      `${player.name} attested correctly (+${lobby.config.attestationRewardEth} ETH)`,
      { playerId: player.id },
    );
  } else {
    player.attestationsMiss += 1;
    player.balance = Math.max(0, roundEth(player.balance - lobby.config.attestationPenaltyEth));
    logAction(
      lobby,
      "attestation_fail",
      `${player.name} attested with wrong answer (−${lobby.config.attestationPenaltyEth} ETH)`,
      { playerId: player.id },
    );
  }
  broadcast(lobby);
}

function handleRename(ws, msg) {
  const lobby = lobbies.get(ws.lobbyId);
  const player = lobby?.players.get(ws.playerId);
  if (!player || !msg.name?.trim()) return;
  const old = player.name;
  player.name = msg.name.trim().slice(0, 20);
  logAction(lobby, "rename", `${old} is now ${player.name}`, { playerId: player.id });
  broadcast(lobby);
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "join") handleJoin(ws, msg);
    else if (msg.type === "attestation") handleAttestation(ws, msg);
    else if (msg.type === "rename") handleRename(ws, msg);
    else if (msg.type === "start") {
      const lobby = lobbies.get(ws.lobbyId);
      if (lobby && lobby.status === "waiting") startSimulation(lobby);
    }
  });

  ws.on("close", () => {
    const lobby = lobbies.get(ws.lobbyId);
    const player = lobby?.players.get(ws.playerId);
    if (player) {
      player.connected = false;
      player.ws = null;
      logAction(lobby, "leave", `${player.name} disconnected`, { playerId: player.id });
      broadcast(lobby);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, lobby] of lobbies) {
    const anyone = [...lobby.players.values()].some((p) => p.connected);
    if (!anyone && lobby.createdAt < cutoff) {
      clearLobbyTimers(lobby);
      lobbies.delete(id);
    }
  }
}, 60 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`PoSSim listening on http://localhost:${PORT}`);
  console.log(`Block interval: ${DEFAULT_CONFIG.blockIntervalMs / 60000} min (set BLOCK_INTERVAL_MINUTES env)`);
});
