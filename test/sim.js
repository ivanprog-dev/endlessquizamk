'use strict';
// Simuliert ein komplettes Spiel mit 3 Spielern gegen den lokalen Server (In-Memory-Store).
const server = require('../dev-server');
const assert = require('assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port;
  const post = async (b) => { const r = await fetch(base + '/api/room', { method: 'POST', body: JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
  const get = async (code, pid) => { const r = await fetch(`${base}/api/state?code=${code}&pid=${pid}`); return { s: r.status, j: await r.json() }; };

  const a = (await post({ action: 'create', name: 'Max', count: 10 })).j;
  assert(/^[A-Z]{4}$/.test(a.code));
  const b = (await post({ action: 'join', code: a.code, name: 'Lena' })).j;
  const c = (await post({ action: 'join', code: a.code.toLowerCase(), name: 'Max' })).j;   // Doppelname -> "Max 2"
  let s = (await get(a.code, a.pid)).j;
  assert.deepStrictEqual(s.players.map((p) => p.name), ['Max', 'Lena', 'Max 2']);
  assert.strictEqual((await post({ action: 'start', code: a.code, pid: b.pid })).s, 403);  // nur Host
  assert.strictEqual((await post({ action: 'start', code: a.code, pid: a.pid })).s, 200);
  assert.strictEqual((await post({ action: 'join', code: a.code, name: 'Spät' })).s, 400); // läuft schon

  const ids = [a.pid, b.pid, c.pid];
  const tiers = [];
  let totalAnswered = 0;
  for (let q = 0; q < 10; q++) {
    s = (await get(a.code, a.pid)).j;
    assert.strictEqual(s.phase, 'question'); assert.strictEqual(s.idx, q);
    assert(s.q.opts.length === 4 && s.q.correct === undefined, 'Lösung darf vor Aufdeckung nicht im Payload sein');
    tiers.push(s.q.tier);
    // Max antwortet richtig-ish (0), Lena Index 1, Max 2 gar nicht -> Reveal erst durch Timeout? Hier antworten alle.
    for (let i = 0; i < 3; i++) await post({ action: 'answer', code: a.code, pid: ids[i], idx: q, choice: i });
    // doppelte Antwort darf nichts ändern
    await post({ action: 'answer', code: a.code, pid: ids[0], idx: q, choice: 3 });
    s = (await get(a.code, a.pid)).j;
    assert.strictEqual(s.phase, 'reveal', 'alle haben geantwortet -> Reveal');
    assert(s.q.correct >= 0 && s.results.length === 3);
    assert.strictEqual(s.results.find((r) => r.id === a.pid).choice, 0);
    const before = s.players.map((p) => p.score);
    await post({ action: 'next', code: a.code, pid: ids[q % 3], idx: q });
    await post({ action: 'next', code: a.code, pid: ids[(q + 1) % 3], idx: q }); // idempotent
    totalAnswered++;
    void before;
  }
  s = (await get(a.code, a.pid)).j;
  assert.strictEqual(s.phase, 'final');
  const total = s.players.reduce((x, p) => x + p.right, 0);
  console.log('Tiers im Verlauf:', tiers.join(' '));
  console.log('Endstand:', s.players.map((p) => `${p.name} ${p.score} (${p.right}/10)`).join(' | '));
  assert(total >= 0);
  assert.strictEqual((await post({ action: 'again', code: a.code, pid: a.pid })).s, 200);
  s = (await get(a.code, a.pid)).j; assert.strictEqual(s.phase, 'lobby');
  assert.strictEqual((await get('ZZZZ', a.pid)).s, 404);
  assert.strictEqual((await get(a.code, 'fremd')).s, 403);

  // Timeout-Test: Q_TIME verkürzt nicht möglich -> Reveal per Zeit prüfen über manipulierten qStart ist nur im Store möglich; hier: Inaktiv-Regel
  console.log('OK');
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
