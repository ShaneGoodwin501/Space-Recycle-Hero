'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const MAX_PLAYERS = 20;
const WORLD_WIDTH = 260;
const SHIP_RADIUS = 0.95;
const MIN_SHIP_SEPARATION = SHIP_RADIUS * 2.4;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

const playersById = new Map();
const playerIdBySession = new Map();
let activeCollision = null;

function hashSessionId(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getSpawnX() {
  for (let i = 0; i < 150; i += 1) {
    const candidate = 2 + Math.random() * (WORLD_WIDTH - 4);
    const clear = Array.from(playersById.values()).every((p) => Math.abs(p.x - candidate) >= MIN_SHIP_SEPARATION);
    if (clear) return candidate;
  }
  return 8 + Math.random() * (WORLD_WIDTH - 16);
}

function getPlayersSnapshot() {
  return Array.from(playersById.values()).map((p) => ({
    playerId: p.playerId,
    x: p.x,
    y: p.y,
    angle: p.angle,
    crashed: p.crashed,
    radioMessage: p.radioMessage,
    lastSeen: p.lastSeen,
  }));
}

function evaluateShipCollisions() {
  const players = Array.from(playersById.values()).filter((p) => !p.crashed);
  activeCollision = null;
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d <= SHIP_RADIUS * 2) {
        a.crashed = true;
        b.crashed = true;
        activeCollision = [a.playerId, b.playerId];
        return;
      }
    }
  }
}

function cleanupInactivePlayers() {
  const now = Date.now();
  for (const [id, player] of playersById.entries()) {
    if (now - player.lastSeen > 30000) {
      playersById.delete(id);
      playerIdBySession.delete(player.sessionKey);
    }
  }
}

const server = http.createServer(async (req, res) => {
  cleanupInactivePlayers();

  if (req.method === 'POST' && req.url === '/api/join') {
    const body = await readJson(req);
    const providedMac = String(body.macAddress || '').trim().toLowerCase();
    const fallback = `${req.socket.remoteAddress || 'unknown'}-${req.headers['user-agent'] || 'ua'}`;
    const sessionKey = hashSessionId(providedMac || fallback);
    const existingId = playerIdBySession.get(sessionKey);

    if (!existingId && playersById.size >= MAX_PLAYERS) {
      sendJson(res, 429, { error: 'max-players' });
      return;
    }

    const playerId = existingId || `p_${sessionKey.slice(0, 8)}`;
    const spawnX = getSpawnX();
    const player = {
      playerId,
      sessionKey,
      x: spawnX,
      y: 0,
      angle: 0,
      crashed: false,
      radioMessage: '',
      lastSeen: Date.now(),
    };
    playersById.set(playerId, player);
    playerIdBySession.set(sessionKey, playerId);
    sendJson(res, 200, { playerId, spawnX });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/state') {
    const body = await readJson(req);
    const player = playersById.get(String(body.playerId || ''));
    if (!player) {
      sendJson(res, 404, { error: 'player-not-found' });
      return;
    }
    player.x = Number(body.x ?? player.x);
    player.y = Number(body.y ?? player.y);
    player.angle = Number(body.angle ?? player.angle);
    player.crashed = Boolean(body.crashed);
    player.radioMessage = String(body.radioMessage || '').slice(0, 120);
    player.lastSeen = Date.now();

    evaluateShipCollisions();
    sendJson(res, 200, { players: getPlayersSnapshot(), collision: activeCollision });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/radio') {
    const body = await readJson(req);
    const player = playersById.get(String(body.playerId || ''));
    if (!player) {
      sendJson(res, 404, { error: 'player-not-found' });
      return;
    }
    player.radioMessage = String(body.text || '').slice(0, 120);
    player.lastSeen = Date.now();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/spawn') {
    const body = await readJson(req);
    const player = playersById.get(String(body.playerId || ''));
    if (!player) {
      sendJson(res, 404, { error: 'player-not-found' });
      return;
    }
    const spawnX = getSpawnX();
    player.x = spawnX;
    player.crashed = false;
    player.lastSeen = Date.now();
    sendJson(res, 200, { spawnX });
    return;
  }

  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(urlPath).replace(/^\.\.(\/|\\|$)+/, '');
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Space Recycle Hero multiplayer server running on http://localhost:${PORT}`);
});
