const STORAGE_PLAYER = "possim_player_id";
const STORAGE_LOBBY = "possim_last_lobby";

const $ = (id) => document.getElementById(id);

let ws;
let playerId = localStorage.getItem(STORAGE_PLAYER) || crypto.randomUUID();
localStorage.setItem(STORAGE_PLAYER, playerId);

let lobbyId = null;
let lobbyState = null;
let timerInterval = null;

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function lobbyPath(id) {
  return `/lobby/${id}`;
}

function inviteUrl(id) {
  return `${location.origin}${lobbyPath(id)}`;
}

function parseLobbyFromPath() {
  const m = location.pathname.match(/^\/lobby\/([A-Za-z0-9]+)\/?$/);
  return m ? m[1].toUpperCase() : null;
}

async function ensureLobbyId() {
  const fromPath = parseLobbyFromPath();
  if (fromPath) return fromPath;

  const res = await fetch("/api/lobby", { method: "POST" });
  const data = await res.json();
  const id = data.id;
  history.replaceState(null, "", lobbyPath(id));
  return id;
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "join",
        lobbyId,
        playerId,
        name: $("nameInput").value,
      }),
    );
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "welcome") {
      playerId = msg.playerId;
      localStorage.setItem(STORAGE_PLAYER, playerId);
      applyLobby(msg.lobby);
      showGame();
    } else if (msg.type === "state") {
      applyLobby(msg.lobby);
    }
  };

  ws.onclose = () => {
    $("connectHint").textContent = "Disconnected — reconnecting in 2s…";
    setTimeout(connectWebSocket, 2000);
  };
}

function showGame() {
  $("connectPanel").hidden = true;
  $("gameGrid").hidden = false;
  $("lobbyChip").hidden = false;
  $("lobbyCode").textContent = lobbyId;
}

function applyLobby(lobby) {
  lobbyState = lobby;
  localStorage.setItem(STORAGE_LOBBY, lobby.id);

  const blockMin = Math.round(lobby.config.blockIntervalMs / 60000);
  $("blockIntervalLabel").textContent = String(blockMin);

  const me = lobby.players.find((p) => p.id === playerId);
  if (me) {
    $("youName").textContent = me.name;
    $("youBalance").textContent = me.balance.toFixed(3);
    $("youOk").textContent = me.attestationsOk;
    $("youMiss").textContent = me.attestationsMiss;
    $("youBlocks").textContent = me.blocksProposed;
  }

  const connected = lobby.players.filter((p) => p.connected).length;
  $("playerCount").textContent = String(lobby.players.length);

  const statusEl = $("simStatus");
  if (lobby.status === "running") {
    statusEl.textContent = `Live · ${connected} online · attestation #${lobby.attestationIndex}`;
    statusEl.classList.add("live");
    $("startBtn").hidden = true;
  } else {
    statusEl.textContent = `${connected} validator(s) connected — starts at 2+ or press Start`;
    statusEl.classList.remove("live");
    $("startBtn").hidden = connected < 1;
  }

  renderPlayers(lobby);
  renderAttestation(lobby);
  renderLog(lobby);
}

function renderPlayers(lobby) {
  const maxBal = Math.max(...lobby.players.map((p) => p.balance), 1);
  const ul = $("playerList");
  ul.innerHTML = lobby.players
    .map((p) => {
      const pct = (p.balance / maxBal) * 100;
      const you = p.id === playerId ? " you" : "";
      return `<li class="${you}">
        <span class="player-name"><span class="dot ${p.connected ? "on" : ""}"></span>${escapeHtml(p.name)}${p.id === playerId ? " (you)" : ""}</span>
        <span class="player-balance">${p.balance.toFixed(3)} ETH</span>
        <span class="player-meta">✓ ${p.attestationsOk} · miss ${p.attestationsMiss} · blocks ${p.blocksProposed}</span>
        <div class="stake-bar-wrap"><div class="stake-bar" style="width:${pct}%"></div></div>
      </li>`;
    })
    .join("");
}

function renderAttestation(lobby) {
  const att = lobby.attestation;
  const choicesEl = $("choices");
  choicesEl.innerHTML = "";

  if (!att) {
    $("puzzlePrompt").textContent =
      lobby.status === "running" ? "Between attestation rounds…" : "Simulation not started yet.";
    $("attTimer").textContent = "—";
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    return;
  }

  $("puzzlePrompt").textContent = att.prompt;
  const meSubmitted = att.submitted.includes(playerId);

  for (const c of att.choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn choice";
    btn.textContent = String(c);
    btn.disabled = meSubmitted || Date.now() > att.endsAt;
    btn.addEventListener("click", () => {
      ws?.send(JSON.stringify({ type: "attestation", choice: c }));
      btn.disabled = true;
    });
    choicesEl.appendChild(btn);
  }

  const tick = () => {
    const left = Math.max(0, att.endsAt - Date.now());
    $("attTimer").textContent = `${(left / 1000).toFixed(1)}s`;
  };
  tick();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tick, 100);
}

function renderLog(lobby) {
  const ul = $("actionLog");
  ul.innerHTML = lobby.actionLog
    .map((a) => {
      const t = new Date(a.at);
      const time = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const tagClass = `tag tag-${a.type.replace(/[^a-z_]/gi, "")}`;
      return `<li><time>${time}</time><span class="${tagClass}">${a.type.replace(/_/g, " ")}</span><span>${escapeHtml(a.message)}</span></li>`;
    })
    .join("");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

$("copyLinkBtn").addEventListener("click", async () => {
  if (!lobbyId) return;
  const url = inviteUrl(lobbyId);
  try {
    await navigator.clipboard.writeText(url);
    $("copyLinkBtn").textContent = "Copied!";
    setTimeout(() => {
      $("copyLinkBtn").textContent = "Copy invite link";
    }, 2000);
  } catch {
    prompt("Copy this link:", url);
  }
});

$("joinBtn").addEventListener("click", async () => {
  $("joinBtn").disabled = true;
  $("connectHint").textContent = "Connecting…";
  try {
    if (!lobbyId) lobbyId = await ensureLobbyId();
    connectWebSocket();
  } catch {
    $("connectHint").textContent = "Could not connect. Is the server running?";
    $("joinBtn").disabled = false;
  }
});

$("startBtn").addEventListener("click", () => {
  ws?.send(JSON.stringify({ type: "start" }));
});

(async () => {
  const pathLobby = parseLobbyFromPath();
  if (pathLobby) {
    lobbyId = pathLobby;
    $("lobbyCode").textContent = lobbyId;
    $("lobbyChip").hidden = false;
    $("connectHint").textContent = "Enter your name and join this lobby.";
  } else {
    try {
      lobbyId = await ensureLobbyId();
      $("lobbyCode").textContent = lobbyId;
      $("lobbyChip").hidden = false;
      $("connectHint").textContent = "Share the link above, then enter to join as a validator.";
    } catch {
      $("connectHint").textContent = "Could not create lobby — start the server and refresh.";
    }
  }
})();
