const DEFAULT_URL = 'wss://octobot-ws.ahmadarif.id';
const LOCAL_URL = /^ws:\/\/(127\.0\.0\.1|localhost):\d+$/;
const ENABLED_KEY = 'oc8-online';
const PROBE_TIMEOUT_MS = 2500;
const SEND_MS = 100;
const IDLE_SEND_MS = 1000;
const MAX_BACKOFF_MS = 30000;

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode can block storage; the choice then lasts for this visit only.
  }
};

/** Only a local address can override the server, so a shared link can never redirect players. */
function serverUrl() {
  const custom = new URLSearchParams(location.search).get('ws');
  return custom && LOCAL_URL.test(custom) ? custom : DEFAULT_URL;
}

/** Connects when it can and stays out of the way when it cannot: the game never depends on it. */
export class Online {
  constructor(state, robot, remote) {
    this.state = state;
    this.robot = robot;
    this.remote = remote;
    this.url = serverUrl();
    this.enabled = false;
    this.lastChoiceWasMulti = read(ENABLED_KEY) !== '0';
    this.status = 'off';
    this.me = null;
    this.room = null;
    this.total = 0;
    this.ws = null;
    this.attempts = 0;
    this.retryTimer = 0;
    this.sinceSend = 0;
    this.sinceForced = 0;
    this.last = null;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.enabled && this.status !== 'online') this.connect();
    });
    addEventListener('online', () => {
      if (this.enabled && this.status !== 'online') this.connect();
    });
  }

  /** Resolves with the player count, or null when offline or the server cannot be reached. */
  async probe() {
    if (navigator.onLine === false || !('WebSocket' in window)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.url.replace(/^ws/, 'http')}/status`, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) return null;
      const { online } = await res.json();
      return Number.isFinite(online) ? online : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  setEnabled(on) {
    this.enabled = on;
    this.lastChoiceWasMulti = on;
    write(ENABLED_KEY, on ? '1' : '0');
    if (on) {
      this.attempts = 0;
      this.connect();
    } else {
      clearTimeout(this.retryTimer);
      this.drop();
      this.status = 'off';
    }
  }

  drop() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.remote.clear();
    this.me = null;
    this.room = null;
    this.total = 0;
    this.last = null;
  }

  connect() {
    clearTimeout(this.retryTimer);
    this.drop();
    this.status = 'connecting';
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onmessage = (e) => this.receive(e.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      this.ws = null;
      this.remote.clear();
      this.me = null;
      this.room = null;
      this.total = 0;
      this.scheduleRetry();
    };
  }

  scheduleRetry() {
    if (!this.enabled) return;
    this.status = 'offline';
    const base = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF_MS);
    this.attempts++;
    // Jitter stops every client hammering the server the moment it comes back.
    this.retryTimer = setTimeout(() => {
      if (!document.hidden) this.connect();
    }, base * (0.7 + Math.random() * 0.6));
  }

  receive(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const now = performance.now();
    if (m.t === 's') {
      for (const entry of m.p) {
        if (entry[0] !== this.me?.id) this.remote.push(entry[0], entry.slice(1), now);
      }
    } else if (m.t === 'j') {
      this.remote.add(m.id, m.name);
      this.total++;
    } else if (m.t === 'l') {
      this.remote.remove(m.id);
      this.total = Math.max(1, this.total - 1);
    } else if (m.t === 'n') {
      this.total = m.online;
    } else if (m.t === 'w') {
      this.status = 'online';
      this.attempts = 0;
      this.me = { id: m.id, name: m.name };
      this.room = m.room;
      this.total = m.online;
      this.last = null;
      for (const p of m.players) {
        this.remote.add(p.id, p.name);
        if (p.s) this.remote.push(p.id, p.s, now);
      }
    }
  }

  snapshot() {
    const s = this.state, T = this.robot.targets;
    const flags = (T.lens > 0.5 ? 1 : 0) | (T.mantle > 0.5 ? 2 : 0) | (T.pump > 0.5 ? 4 : 0) | (T.explode > 0.5 ? 8 : 0);
    const wrappedYaw = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw));
    return [s.pos.x, s.pos.y, s.pos.z, wrappedYaw, s.pitch, s.roll, s.speed, s.jet, flags];
  }

  update(dtMs) {
    if (!this.ws || this.status !== 'online' || this.ws.readyState !== 1) return;
    this.sinceSend += dtMs;
    this.sinceForced += dtMs;
    if (this.sinceSend < SEND_MS) return;
    this.sinceSend = 0;
    const now = this.snapshot();
    // A resting robot only needs an occasional heartbeat, which also saves mobile data.
    const moved = !this.last || now.some((v, i) => Math.abs(v - this.last[i]) > (i < 3 ? 0.02 : 0.01));
    if (!moved && this.sinceForced < IDLE_SEND_MS) return;
    this.ws.send(JSON.stringify(now.map((v) => Math.round(v * 1000) / 1000)));
    this.last = now;
    this.sinceForced = 0;
  }

  /** Other players, nearest first, for the settings list and the radar. */
  others() {
    return [...this.remote.players.values()].filter((p) => p.ready).sort((a, b) => a.distance - b.distance);
  }
}
