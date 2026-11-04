import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const ROOM_SIZE = 20;
const MAX_TOTAL = 200;
export const MAX_PER_IP = 6;
const TICK_MS = 100;
const COUNT_EVERY_MS = 5000;
const IDLE_MS = 30000;
const MAX_MESSAGES_PER_SECOND = 30;
const FIELDS = 9;
const LIMITS = [1e7, 1e4, 1e7, 1e3, Math.PI, Math.PI, 40, 1, 15]; // x y z yaw pitch roll speed jet flags
const DECIMALS = [2, 2, 2, 3, 3, 3, 1, 2, 0];

const ALLOWED_ORIGINS = new Set(['https://octobot.ahmadarif.id', 'https://localhost', 'capacitor://localhost', 'null']);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const NAMES = ['Kerang', 'Terumbu', 'Nautilus', 'Karang', 'Lumba', 'Pari', 'Cumi', 'Bintang', 'Teripang', 'Arus', 'Ombak', 'Palung', 'Mutiara', 'Jangkar', 'Sonar', 'Kompas'];

const round = (value, decimals) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/** Returns a clean state array, or null for anything that is not a valid update. */
export function parseState(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length !== FIELDS) return null;
  const out = new Array(FIELDS);
  for (let i = 0; i < FIELDS; i++) {
    const v = data[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LIMITS[i]) return null;
    out[i] = round(v, DECIMALS[i]);
  }
  if (data[7] < 0 || data[8] < 0 || !Number.isInteger(data[8])) return null;
  return out;
}

export function startServer({ port = 0, host = '127.0.0.1', roomSize = ROOM_SIZE, maxPerIp = MAX_PER_IP, maxTotal = MAX_TOTAL } = {}) {
  const rooms = new Map();
  const perIp = new Map();
  let nextId = 1;
  let nextRoom = 1;
  let total = 0;

  const http = createServer((req, res) => {
    // Lets the start menu show who is online without joining a room and appearing to other players.
    if (req.url === '/status') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ online: total }));
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, players: total, rooms: rooms.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // The server only listens on loopback, so X-Real-IP always comes from nginx.
  const addressOf = (req) => req.headers['x-real-ip'] || req.socket.remoteAddress;

  const wss = new WebSocketServer({
    server: http,
    maxPayload: 256,
    perMessageDeflate: false,
    verifyClient({ origin, req }, done) {
      const okOrigin = !origin || ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin);
      if (!okOrigin) return done(false, 403, 'Origin not allowed');
      if (total >= maxTotal) return done(false, 503, 'Server full');
      if ((perIp.get(addressOf(req)) || 0) >= maxPerIp) return done(false, 429, 'Too many connections');
      return done(true);
    },
  });

  const send = (player, message) => {
    if (player.ws.readyState === player.ws.OPEN) player.ws.send(message);
  };
  const broadcast = (room, message, except) => {
    for (const p of room.players.values()) if (p !== except) send(p, message);
  };

  const roomWithSpace = () => {
    for (const room of rooms.values()) if (room.players.size < roomSize) return room;
    const room = { id: nextRoom++, players: new Map() };
    rooms.set(room.id, room);
    return room;
  };

  const uniqueName = (room) => {
    const used = new Set([...room.players.values()].map((p) => p.name));
    for (let i = 0; i < 64; i++) {
      const name = `${NAMES[Math.floor(Math.random() * NAMES.length)]}-${10 + Math.floor(Math.random() * 90)}`;
      if (!used.has(name)) return name;
    }
    return `Robot-${nextId}`;
  };

  wss.on('connection', (ws, req) => {
    const ip = addressOf(req);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    total++;
    const room = roomWithSpace();
    const player = {
      id: nextId++, name: uniqueName(room), ws, room, state: null, dirty: false,
      lastSeen: Date.now(), windowStart: Date.now(), messages: 0,
    };
    room.players.set(player.id, player);
    send(player, JSON.stringify({
      t: 'w', id: player.id, name: player.name, room: room.id, online: total,
      players: [...room.players.values()].filter((p) => p !== player).map((p) => ({ id: p.id, name: p.name, s: p.state })),
    }));
    broadcast(room, JSON.stringify({ t: 'j', id: player.id, name: player.name }), player);

    ws.on('message', (data, isBinary) => {
      player.lastSeen = Date.now();
      if (player.lastSeen - player.windowStart >= 1000) {
        player.windowStart = player.lastSeen;
        player.messages = 0;
      }
      if (++player.messages > MAX_MESSAGES_PER_SECOND) {
        ws.close(1008, 'Rate limit');
        return;
      }
      if (isBinary) return;
      const state = parseState(data.toString());
      if (!state) return;
      player.state = state;
      player.dirty = true;
    });
    ws.on('pong', () => {
      player.lastSeen = Date.now();
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      room.players.delete(player.id);
      total--;
      const left = perIp.get(ip) - 1;
      if (left > 0) perIp.set(ip, left);
      else perIp.delete(ip);
      if (room.players.size === 0) rooms.delete(room.id);
      else broadcast(room, JSON.stringify({ t: 'l', id: player.id }));
    });
  });

  const tick = setInterval(() => {
    for (const room of rooms.values()) {
      const changed = [];
      for (const p of room.players.values()) {
        if (!p.dirty) continue;
        p.dirty = false;
        changed.push([p.id, ...p.state]);
      }
      if (changed.length) broadcast(room, JSON.stringify({ t: 's', p: changed }));
    }
  }, TICK_MS);

  const counter = setInterval(() => {
    const message = JSON.stringify({ t: 'n', online: total });
    for (const room of rooms.values()) broadcast(room, message);
  }, COUNT_EVERY_MS);

  const reaper = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const p of room.players.values()) {
        if (now - p.lastSeen > IDLE_MS) p.ws.terminate();
        else if (p.ws.readyState === p.ws.OPEN) p.ws.ping();
      }
    }
  }, IDLE_MS / 3);

  const close = () => new Promise((resolve) => {
    clearInterval(tick);
    clearInterval(counter);
    clearInterval(reaper);
    for (const client of wss.clients) client.terminate();
    wss.close(() => http.close(() => resolve()));
  });

  return new Promise((resolve) => {
    http.listen(port, host, () => resolve({ port: http.address().port, close, stats: () => ({ total, rooms: rooms.size }) }));
  });
}
