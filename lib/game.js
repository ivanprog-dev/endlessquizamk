'use strict';
const crypto = require('crypto');
const { pipeline, obj } = require('./store');
const RAW = require('./questions.json'); // [Kategorie, Rating, Frage, richtig, [falsch x3], Wiki-Begriff]

const Q_TIME = 15000;   // ms pro Frage
const GRACE = 1500;     // ms Toleranz für Netzlatenz beim Antworten
const ACTIVE = 12000;   // Spieler ohne Poll in den letzten 12 s zählen nicht für „alle haben geantwortet“
const MAX_PLAYERS = 8;
const TTL = 6 * 3600;
const COUNTS = [10, 15, 20];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const tierOf = (r) => clamp(Math.round((r - 700) / 125) + 1, 1, 9);
const POOL = RAW.map((e, i) => ({ i, c: e[0], r: e[1], t: e[2], a: e[3], w: e[4], wiki: e[5], tier: tierOf(e[1]) }));

class GameError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

const K = (code, s) => `r:${code}:${s}`;
const rnd = (n) => crypto.randomInt(n);
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Fragenreihe mit steigender Schwierigkeit (Tier 2 -> 8), Kategorien möglichst abwechselnd
function buildQuestions(count) {
  const used = new Set(); const out = []; let lastCat = null;
  for (let i = 0; i < count; i++) {
    const target = 1.5 + 7 * (count === 1 ? 0.5 : i / (count - 1));
    const t = clamp(Math.round(target + (Math.random() - 0.5) * 1.6), 1, 9);
    let cand = [];
    for (const d of [0, 1, 2, 3]) {
      cand = POOL.filter((q) => !used.has(q.i) && Math.abs(q.tier - t) <= d);
      if (cand.length > 20) break;
    }
    const diff = cand.filter((q) => q.c !== lastCat);
    const q = (diff.length ? diff : cand)[rnd((diff.length ? diff : cand).length)];
    used.add(q.i); lastCat = q.c;
    const opts = shuffle([q.a, ...q.w]);
    out.push({ c: q.c, r: q.r, tier: q.tier, t: q.t, opts, correct: opts.indexOf(q.a), wiki: q.wiki });
  }
  return out;
}

function cleanName(n) {
  n = String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  if (!n) throw new GameError('Name fehlt');
  return n;
}
function cleanCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }
const newId = () => crypto.randomBytes(8).toString('hex');

async function loadRoom(code) {
  const [meta, players] = (await pipeline([['HGETALL', K(code, 'meta')], ['HGETALL', K(code, 'p')]])).map(obj);
  if (!meta.phase) throw new GameError('Raum nicht gefunden', 404);
  return { meta, players };
}

async function createRoom({ name, count }) {
  name = cleanName(name);
  count = COUNTS.includes(+count) ? +count : 10;
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let tries = 0; tries < 20; tries++) {
    let code = ''; for (let i = 0; i < 4; i++) code += L[rnd(L.length)];
    const [ok] = await pipeline([['HSETNX', K(code, 'meta'), 'phase', 'lobby']]);
    if (!ok) continue;
    const pid = newId(); const now = Date.now();
    await pipeline([
      ['HSET', K(code, 'meta'), 'host', pid, 'count', count, 'idx', 0, 'created', now],
      ['HSET', K(code, 'p'), pid, JSON.stringify({ name, at: now })],
      ['HSET', K(code, 'seen'), pid, now],
      ...['meta', 'p', 'seen', 'res'].map((s) => ['EXPIRE', K(code, s), TTL]),
    ]);
    return { code, pid };
  }
  throw new GameError('Kein freier Raumcode, bitte erneut versuchen', 503);
}

async function joinRoom({ code, name, pid }) {
  code = cleanCode(code);
  const { meta, players } = await loadRoom(code);
  if (pid && players[pid]) return { code, pid };
  if (meta.phase !== 'lobby') throw new GameError('Das Spiel läuft schon');
  if (Object.keys(players).length >= MAX_PLAYERS) throw new GameError('Raum ist voll (max. ' + MAX_PLAYERS + ')');
  name = cleanName(name);
  const taken = new Set(Object.values(players).map((p) => JSON.parse(p).name.toLowerCase()));
  let n = name, i = 2; while (taken.has(n.toLowerCase())) n = name.slice(0, 13) + ' ' + i++;
  pid = newId();
  await pipeline([
    ['HSET', K(code, 'p'), pid, JSON.stringify({ name: n, at: Date.now() })],
    ['HSET', K(code, 'seen'), pid, Date.now()],
  ]);
  return { code, pid };
}

async function startGame({ code, pid }) {
  code = cleanCode(code);
  const { meta, players } = await loadRoom(code);
  if (!players[pid]) throw new GameError('Nicht im Raum', 403);
  if (meta.host !== pid) throw new GameError('Nur der Host kann starten', 403);
  if (meta.phase !== 'lobby') return {};
  const qs = buildQuestions(+meta.count);
  await pipeline([
    ['HSET', K(code, 'meta'), 'questions', JSON.stringify(qs), 'idx', 0, 'qStart', Date.now(), 'phase', 'question'],
  ]);
  return {};
}

async function answer({ code, pid, idx, choice }) {
  code = cleanCode(code);
  const { meta, players } = await loadRoom(code);
  if (!players[pid]) throw new GameError('Nicht im Raum', 403);
  choice = +choice;
  if (!(choice >= 0 && choice <= 3)) throw new GameError('Ungültige Antwort');
  const now = Date.now();
  if (meta.phase !== 'question' || +meta.idx !== +idx || now > +meta.qStart + Q_TIME + GRACE) return { late: true };
  await pipeline([
    ['HSETNX', K(code, `a${idx}`), pid, JSON.stringify({ c: choice, t: now })],
    ['EXPIRE', K(code, `a${idx}`), TTL],
  ]);
  return {};
}

async function next({ code, pid, idx }) {
  code = cleanCode(code);
  const { meta, players } = await loadRoom(code);
  if (!players[pid]) throw new GameError('Nicht im Raum', 403);
  if (meta.phase !== 'reveal' || +meta.idx !== +idx) return {};
  const n = +meta.idx + 1;
  if (n >= +meta.count) await pipeline([['HSET', K(code, 'meta'), 'phase', 'final']]);
  else await pipeline([['HSET', K(code, 'meta'), 'idx', n, 'qStart', Date.now(), 'phase', 'question']]);
  return {};
}

async function again({ code, pid }) {
  code = cleanCode(code);
  const { meta, players } = await loadRoom(code);
  if (meta.host !== pid || !players[pid]) throw new GameError('Nur der Host', 403);
  if (meta.phase !== 'final') return {};
  const dels = [['DEL', K(code, 'res'), ...Array.from({ length: +meta.count }, (_, i) => K(code, `a${i}`))]];
  await pipeline([...dels, ['HSET', K(code, 'meta'), 'phase', 'lobby', 'idx', 0, 'questions', '']]);
  return {};
}

function points(q, ans, qStart) {
  if (!ans) return { choice: -1, ok: false, pts: 0, ms: null };
  const ms = clamp(ans.t - qStart, 0, Q_TIME);
  const ok = ans.c === q.correct;
  return { choice: ans.c, ok, ms, pts: ok ? 100 + 15 * (q.tier - 1) + Math.round(60 * (1 - ms / Q_TIME)) : 0 };
}

async function state({ code, pid }) {
  code = cleanCode(code);
  const now = Date.now();
  const [, , metaR, pR, seenR, resR] = await pipeline([
    ['HSET', K(code, 'seen'), pid || '-', now],
    ['EXPIRE', K(code, 'seen'), TTL],
    ['HGETALL', K(code, 'meta')], ['HGETALL', K(code, 'p')], ['HGETALL', K(code, 'seen')], ['HGETALL', K(code, 'res')],
  ]);
  const meta = obj(metaR), players = obj(pR), seen = obj(seenR), res = obj(resR);
  if (!meta.phase) throw new GameError('Raum nicht gefunden', 404);
  if (!players[pid]) throw new GameError('Nicht im Raum', 403);
  const idx = +meta.idx;
  const qs = meta.questions ? JSON.parse(meta.questions) : null;
  let answers = {};
  let phase = meta.phase;

  if (phase === 'question' || phase === 'reveal') {
    answers = obj((await pipeline([['HGETALL', K(code, `a${idx}`)]]))[0]);
  }
  if (phase === 'question') {
    const qStart = +meta.qStart;
    const active = Object.keys(players).filter((id) => now - +(seen[id] || 0) < ACTIVE || answers[id]);
    const all = active.every((id) => answers[id]);
    if (all || now >= qStart + Q_TIME + GRACE) {
      const q = qs[idx];
      const r = Object.keys(players).map((id) => ({ id, ...points(q, answers[id] && JSON.parse(answers[id]), qStart) }));
      const [, , stored] = await pipeline([
        ['HSETNX', K(code, 'res'), idx, JSON.stringify(r)],
        ['HSET', K(code, 'meta'), 'phase', 'reveal'],
        ['HGET', K(code, 'res'), idx],
      ]);
      res[idx] = stored;
      phase = 'reveal';
    }
  }

  // Punktestand aus allen aufgedeckten Fragen
  const score = {}, right = {};
  for (const id of Object.keys(players)) { score[id] = 0; right[id] = 0; }
  for (const k of Object.keys(res)) for (const r of JSON.parse(res[k])) { if (score[r.id] != null) { score[r.id] += r.pts; right[r.id] += r.ok ? 1 : 0; } }

  const view = {
    now, code, phase, idx, count: +meta.count, host: meta.host, me: pid, qTime: Q_TIME, qStart: +meta.qStart || 0,
    players: Object.keys(players).map((id) => ({
      id, name: JSON.parse(players[id]).name, score: score[id], right: right[id],
      answered: !!answers[id], active: now - +(seen[id] || 0) < ACTIVE,
    })),
  };
  if (qs && (phase === 'question' || phase === 'reveal')) {
    const q = qs[idx];
    view.q = { c: q.c, tier: q.tier, t: q.t, opts: q.opts };
    view.myChoice = answers[pid] ? JSON.parse(answers[pid]).c : null;
    if (phase === 'reveal') {
      view.q.correct = q.correct; view.q.wiki = q.wiki;
      view.results = JSON.parse(res[idx]).map((r) => ({ ...r, name: JSON.parse(players[r.id]).name }));
    }
  }
  return view;
}

module.exports = { createRoom, joinRoom, startGame, answer, next, again, state, GameError, Q_TIME, buildQuestions };
