import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import { openDatabase, readEvents, readEventsByAggregate } from '../db/store.js';
import { WorldClock } from '../domain/clock.js';
import { buildPlayerProjection } from '../domain/player.js';
import { buildSiteProjection } from '../domain/site.js';
import { processTick } from '../domain/tick.js';
import { handleGiveMoney, PLAYER_ID } from '../commands/giveMoney.js';
import { handleBuildFarm, SITE_ID } from '../commands/buildFarm.js';
import { handleUpgradeFarm } from '../commands/upgradeFarm.js';
import type Database from 'better-sqlite3';

const DB_PATH = 'data/events.db';
const PORT = 3001;

let db: Database.Database = openDatabase(DB_PATH);
WorldClock.init(db);

// ── Pause state ───────────────────────────────────────────────────────────────
let paused = false;
let pausedClockUs = 0;

function pause() {
  if (!paused) {
    pausedClockUs = WorldClock.now();
    paused = true;
  }
}

function resume() {
  paused = false;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────
function getSnapshot() {
  const allEvents = readEvents(db);
  const player = buildPlayerProjection(readEventsByAggregate(db, 'Player', PLAYER_ID));
  const site = buildSiteProjection(readEventsByAggregate(db, 'Site', SITE_ID));

  // WorldTickAdvanced events are system noise — exclude them from the "game events" count
  const tick_count = allEvents.filter((e) => e.event_type === 'WorldTickAdvanced').length;
  const game_event_count = allEvents.length - tick_count;
  const completion_count = allEvents.filter(
    (e) => e.event_type === 'FarmBuildCompleted' || e.event_type === 'FarmUpgradeCompleted',
  ).length;

  return {
    player,
    site,
    world_clock_us: paused ? pausedClockUs : WorldClock.now(),
    game_event_count,
    tick_count,
    completion_count,
    paused,
  };
}

function broadcast(wss: WebSocketServer, payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function resetWorld() {
  paused = false;
  db.close();
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  WorldClock._reset();
  db = openDatabase(DB_PATH);
  WorldClock.init(db);
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS for dev (Vite on 8080 → Express on 3001)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.get('/api/state', (_req, res) => res.json(getSnapshot()));

app.post('/api/pause', (_req, res) => {
  pause();
  broadcast(wss, getSnapshot());
  res.json(getSnapshot());
});

app.post('/api/resume', (_req, res) => {
  resume();
  broadcast(wss, getSnapshot());
  res.json(getSnapshot());
});

app.post('/api/commands/give-money', (req, res) => {
  const amount = Number((req.body as Record<string, unknown>).amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }
  try {
    handleGiveMoney(db, { amount });
    res.json(getSnapshot());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/commands/build-farm', (_req, res) => {
  try {
    handleBuildFarm(db);
    res.json(getSnapshot());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/commands/upgrade-farm', (_req, res) => {
  try {
    handleUpgradeFarm(db);
    res.json(getSnapshot());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/reset', (_req, res) => {
  resetWorld();
  broadcast(wss, getSnapshot());
  res.json(getSnapshot());
});

// ── WebSocket + tick loop ─────────────────────────────────────────────────────
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify(getSnapshot()));
});

let tickAccumulator = 0;
setInterval(() => {
  if (!paused) processTick(db);
  tickAccumulator += 100;
  if (tickAccumulator >= 250) {
    broadcast(wss, getSnapshot());
    tickAccumulator = 0;
  }
}, 100);

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
