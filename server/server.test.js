import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { parseState, startServer } from './server.js';

const GOOD = [1, 2, 3, 0.5, 0.1, -0.1, 6.5, 0, 0];
let server;
let url;
const open = [];

const collect = (ws) => {
  ws.inbox = [];
  ws.on('message', (d) => ws.inbox.push(JSON.parse(d.toString())));
};
const connect = (options) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url, options);
  open.push(ws);
  collect(ws);
  ws.once('open', () => resolve(ws));
  ws.once('unexpected-response', (_, res) => reject(new Error(String(res.statusCode))));
  ws.once('error', reject);
});
const waitFor = async (check, ms = 1500) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timed out');
};
const closeAll = async () => {
  for (const ws of open.splice(0)) ws.close();
  await waitFor(() => server.stats().total === 0);
};

before(async () => {
  server = await startServer({ roomSize: 3, maxPerIp: 5 });
  url = `ws://127.0.0.1:${server.port}`;
});
after(() => server.close());

test('parseState accepts a valid update and rounds it', () => {
  assert.deepEqual(parseState(JSON.stringify([1.2345, 2, 3, 0.12345, 0, 0, 6.55, 0.5, 3])), [1.23, 2, 3, 0.123, 0, 0, 6.6, 0.5, 3]);
});

test('parseState rejects anything malformed or out of range', () => {
  for (const bad of ['nope', '{}', '[]', '[1,2,3]', JSON.stringify([...GOOD, 1]), JSON.stringify(['1', ...GOOD.slice(1)]),
    '[1e9,2,3,0,0,0,0,0,0]', '[1,2,3,0,0,0,99,0,0]', '[1,2,3,0,0,0,0,-1,0]', '[1,2,3,0,0,0,0,0,1.5]', '[null,2,3,0,0,0,0,0,0]']) {
    assert.equal(parseState(bad), null, bad);
  }
});

test('players see each other join, move, and leave', async () => {
  const a = await connect();
  const welcomeA = await waitFor(() => a.inbox.find((m) => m.t === 'w'));
  assert.match(welcomeA.name, /^\S+-\d+$/);
  const b = await connect();
  const welcomeB = await waitFor(() => b.inbox.find((m) => m.t === 'w'));
  assert.equal(welcomeB.room, welcomeA.room);
  assert.equal(welcomeB.players[0].id, welcomeA.id);
  assert.notEqual(welcomeB.name, welcomeA.name);
  await waitFor(() => a.inbox.find((m) => m.t === 'j' && m.id === welcomeB.id));
  b.send(JSON.stringify(GOOD));
  const snap = await waitFor(() => a.inbox.find((m) => m.t === 's'));
  assert.deepEqual(snap.p[0], [welcomeB.id, ...GOOD]);
  b.close();
  await waitFor(() => a.inbox.find((m) => m.t === 'l' && m.id === welcomeB.id));
  await closeAll();
});

test('a new player receives the state of those already present', async () => {
  const a = await connect();
  a.send(JSON.stringify(GOOD));
  await new Promise((r) => setTimeout(r, 150));
  const b = await connect();
  const welcome = await waitFor(() => b.inbox.find((m) => m.t === 'w'));
  assert.deepEqual(welcome.players[0].s, GOOD);
  await closeAll();
});

test('invalid updates never reach other players', async () => {
  const a = await connect();
  const b = await connect();
  await waitFor(() => a.inbox.find((m) => m.t === 'j'));
  b.send('[1e99,0,0,0,0,0,0,0,0]');
  b.send(Buffer.from([1, 2, 3]));
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(a.inbox.some((m) => m.t === 's'), false);
  await closeAll();
});

test('a full room overflows into a new one', async () => {
  const sockets = [await connect(), await connect(), await connect(), await connect()];
  const welcomes = await Promise.all(sockets.map((ws) => waitFor(() => ws.inbox.find((m) => m.t === 'w'))));
  assert.equal(new Set(welcomes.slice(0, 3).map((w) => w.room)).size, 1);
  assert.notEqual(welcomes[3].room, welcomes[0].room);
  assert.equal(welcomes[3].players.length, 0);
  assert.equal(server.stats().rooms, 2);
  await closeAll();
  assert.equal(server.stats().rooms, 0);
});

test('other websites are refused', async () => {
  await assert.rejects(connect({ origin: 'https://evil.example' }), /403/);
  const app = await connect({ origin: 'https://localhost' });
  assert.equal(app.readyState, WebSocket.OPEN);
  await closeAll();
});

test('one address cannot hold too many connections', async () => {
  const sockets = [];
  for (let i = 0; i < 5; i++) sockets.push(await connect());
  await assert.rejects(connect(), /429/);
  await closeAll();
  const again = await connect();
  assert.equal(again.readyState, WebSocket.OPEN);
  await closeAll();
});

test('a flooding client gets disconnected', async () => {
  const flood = await connect();
  const closed = new Promise((resolve) => flood.once('close', resolve));
  for (let i = 0; i < 40; i++) flood.send(JSON.stringify(GOOD));
  assert.equal(await closed, 1008);
  await closeAll();
});

test('oversized messages close the connection', async () => {
  const big = await connect();
  const closed = new Promise((resolve) => big.once('close', resolve));
  big.send('x'.repeat(1000));
  assert.equal(await closed, 1009);
  await closeAll();
});

test('status reports the player count without joining a room', async () => {
  const a = await connect();
  await waitFor(() => a.inbox.find((m) => m.t === 'w'));
  const res = await fetch(`http://127.0.0.1:${server.port}/status`);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { online: 1 });
  assert.equal(server.stats().total, 1);
  assert.equal(a.inbox.some((m) => m.t === 'j'), false);
  await closeAll();
});
