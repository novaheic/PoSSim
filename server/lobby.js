import crypto from "crypto";

const LOBBY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NAMES = [
  "Amber", "Basil", "Coral", "Dawn", "Ember", "Frost", "Grove", "Haze",
  "Ivory", "Jade", "Kite", "Lumen", "Mist", "Nova", "Orbit", "Pulse",
  "Quartz", "River", "Sage", "Tide", "Umber", "Violet", "Willow", "Zephyr",
];

export const DEFAULT_CONFIG = {
  attestationIntervalMs: 30_000,
  blockIntervalMs: 2 * 60_000,
  blockRewardEth: 2,
  attestationRewardEth: 0.05,
  attestationPenaltyEth: 0.15,
  minStakeEth: 8,
  maxStakeEth: 64,
};

export function randomLobbyId() {
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += LOBBY_CHARS[crypto.randomInt(LOBBY_CHARS.length)];
  }
  return id;
}

export function randomPlayerName(used) {
  const pool = NAMES.filter((n) => !used.has(n));
  const pick = pool.length ? pool : NAMES;
  return pick[crypto.randomInt(pick.length)];
}

export function randomStake(min, max) {
  const whole = crypto.randomInt(min, max + 1);
  const frac = crypto.randomInt(0, 100) / 100;
  return Math.round((whole + frac) * 100) / 100;
}

export function makePuzzle() {
  const a = crypto.randomInt(2, 25);
  const b = crypto.randomInt(2, 25);
  const op = crypto.randomInt(0, 2) === 0 ? "+" : "−";
  const answer = op === "+" ? a + b : a - b;
  const prompt = `${a} ${op} ${b} = ?`;

  const wrong = new Set();
  while (wrong.size < 3) {
    const delta = crypto.randomInt(-8, 9) || 1;
    const w = answer + delta;
    if (w !== answer) wrong.add(w);
  }
  const choices = [answer, ...wrong];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { prompt, answer, choices };
}

export function pickBlockProposer(players) {
  const eligible = players.filter((p) => p.connected && p.balance > 0);
  if (!eligible.length) return null;
  const total = eligible.reduce((s, p) => s + p.balance, 0);
  let r = crypto.randomInt(0, Math.floor(total * 100)) / 100;
  for (const p of eligible) {
    r -= p.balance;
    if (r <= 0) return p;
  }
  return eligible[eligible.length - 1];
}

export function createLobby(id, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return {
    id,
    createdAt: Date.now(),
    config: cfg,
    status: "waiting",
    startedAt: null,
    players: new Map(),
    actionLog: [],
    attestation: null,
    attestationIndex: 0,
    blockIndex: 0,
    timers: { attestation: null, block: null },
  };
}

export function logAction(lobby, type, message, meta = {}) {
  const entry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    type,
    message,
    ...meta,
  };
  lobby.actionLog.unshift(entry);
  if (lobby.actionLog.length > 120) lobby.actionLog.length = 120;
  return entry;
}

export function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    balance: p.balance,
    connected: p.connected,
    attestationsOk: p.attestationsOk,
    attestationsMiss: p.attestationsMiss,
    blocksProposed: p.blocksProposed,
    lastAttestationAt: p.lastAttestationAt,
  };
}

export function publicLobby(lobby) {
  const att = lobby.attestation;
  return {
    id: lobby.id,
    status: lobby.status,
    startedAt: lobby.startedAt,
    config: lobby.config,
    attestationIndex: lobby.attestationIndex,
    blockIndex: lobby.blockIndex,
    players: [...lobby.players.values()].map(publicPlayer).sort((a, b) => b.balance - a.balance),
    actionLog: lobby.actionLog,
    attestation: att
      ? {
          id: att.id,
          prompt: att.prompt,
          choices: att.choices,
          endsAt: att.endsAt,
          submitted: Object.keys(att.submitted),
        }
      : null,
  };
}
