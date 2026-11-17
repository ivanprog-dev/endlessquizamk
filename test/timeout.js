'use strict';
// Timeout- und Inaktiv-Regel: Reveal nach Ablauf bzw. wenn nur noch aktive Spieler fehlen.
const assert = require('assert');
const g = require('../lib/game');
const { pipeline } = require('../lib/store');
(async () => {
  const a = await g.createRoom({ name: 'A', count: 10 });
  const b = await g.joinRoom({ code: a.code, name: 'B' });
  await g.startGame(a);
  let s = await g.state({ code: a.code, pid: a.pid });
  assert.strictEqual(s.phase, 'question');
  await g.answer({ code: a.code, pid: a.pid, idx: 0, choice: 0 });
  s = await g.state({ code: a.code, pid: a.pid });
  assert.strictEqual(s.phase, 'question', 'B ist aktiv und hat nicht geantwortet -> warten');
  // Zeit ablaufen lassen
  await pipeline([['HSET', `r:${a.code}:meta`, 'qStart', Date.now() - 20000]]);
  s = await g.state({ code: a.code, pid: a.pid });
  assert.strictEqual(s.phase, 'reveal');
  assert.strictEqual(s.results.find((r) => r.id === b.pid).choice, -1);
  // späte Antwort wird abgelehnt
  const late = await g.answer({ code: a.code, pid: b.pid, idx: 0, choice: 1 });
  assert(late.late);
  // nächste Frage; B wird inaktiv -> A allein genügt
  await g.next({ code: a.code, pid: a.pid, idx: 0 });
  await pipeline([['HSET', `r:${a.code}:seen`, b.pid, Date.now() - 60000]]);
  await g.answer({ code: a.code, pid: a.pid, idx: 1, choice: 2 });
  s = await g.state({ code: a.code, pid: a.pid });
  assert.strictEqual(s.phase, 'reveal', 'inaktiver Spieler blockiert nicht');
  console.log('timeout OK');
})().catch((e) => { console.error(e); process.exit(1); });
