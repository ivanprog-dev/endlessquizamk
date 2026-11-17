'use strict';
const assert = require('assert');
const g = require('../lib/game');
(async () => {
  const a = await g.createRoom({ name: 'Max', count: 10 });
  const priv = await g.createRoom({ name: 'Geheim', count: 10, isPublic: false });
  let l = (await g.listRooms()).rooms.map((r) => r.code);
  assert(l.includes(a.code) && !l.includes(priv.code), 'öffentlich ja, privat nein');
  const b = await g.joinRoom({ code: a.code, name: 'Lena' });
  assert.strictEqual((await g.listRooms()).rooms.find((r) => r.code === a.code).players, 2);
  await g.leaveRoom(a);                                   // Host geht -> Lena wird Host
  let s = await g.state({ code: a.code, pid: b.pid });
  assert.strictEqual(s.host, b.pid); assert.strictEqual(s.players.length, 1);
  assert.strictEqual((await g.listRooms()).rooms.find((r) => r.code === a.code).host, 'Lena');
  await assert.rejects(g.state({ code: a.code, pid: a.pid }), /nicht im Raum/i);
  await g.leaveRoom(b);                                   // letzter geht -> Raum weg
  l = (await g.listRooms()).rooms.map((r) => r.code);
  assert(!l.includes(a.code));
  await assert.rejects(g.state({ code: a.code, pid: b.pid }), /nicht gefunden/i);
  // Start entfernt aus der Liste; Verlassen mitten im Spiel blockiert nicht
  const c = await g.createRoom({ name: 'A', count: 10 }); const d = await g.joinRoom({ code: c.code, name: 'B' });
  await g.startGame(c);
  assert(!(await g.listRooms()).rooms.some((r) => r.code === c.code));
  await g.answer({ code: c.code, pid: c.pid, idx: 0, choice: 0 });
  await g.leaveRoom(d);
  s = await g.state({ code: c.code, pid: c.pid });
  assert.strictEqual(s.phase, 'reveal'); assert.strictEqual(s.results.length, 1);
  console.log('rooms OK');
})().catch((e) => { console.error(e); process.exit(1); });
