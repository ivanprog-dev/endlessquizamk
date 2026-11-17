'use strict';
// Redis-Zugriff über die Upstash-REST-API (kein npm-Paket nötig).
// Ohne Umgebungsvariablen läuft ein In-Memory-Store (nur für lokale Tests, nicht für Vercel).
// Variablennamen: Vercel/Upstash setzt je nach Integration (und gewähltem Präfix) z. B. KV_REST_API_URL,
// UPSTASH_REDIS_REST_URL oder STORAGE_KV_REST_API_URL. Wir suchen deshalb nach dem Muster.
function findEnv(re) {
  const k = Object.keys(process.env).find((n) => re.test(n) && process.env[n]);
  return k ? process.env[k] : undefined;
}
const URL_ = findEnv(/(^|_)(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/);
const TOKEN = findEnv(/(^|_)(KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN)$/);

const mem = new Map();
function memExec(cmd) {
  const [op, key, ...a] = cmd;
  const O = String(op).toUpperCase();
  const hash = () => { let h = mem.get(key); if (!h) { h = new Map(); mem.set(key, h); } return h; };
  switch (O) {
    case 'HSET': { const h = hash(); let n = 0; for (let i = 0; i < a.length; i += 2) { if (!h.has(String(a[i]))) n++; h.set(String(a[i]), String(a[i + 1])); } return n; }
    case 'HSETNX': { const h = hash(); if (h.has(String(a[0]))) return 0; h.set(String(a[0]), String(a[1])); return 1; }
    case 'HGET': { const h = mem.get(key); return h && h.has(String(a[0])) ? h.get(String(a[0])) : null; }
    case 'HGETALL': { const h = mem.get(key); const o = []; if (h) for (const [k, v] of h) o.push(k, v); return o; }
    case 'DEL': { let n = 0; for (const k of [key, ...a]) if (mem.delete(k)) n++; return n; }
    case 'EXPIRE': return 1;
    default: throw new Error('mem: unbekannter Befehl ' + O);
  }
}

async function pipeline(cmds) {
  if (!URL_) {
    // Auf Vercel hat jede Funktionsinstanz eigenen Speicher -> der Fallback wäre stillschweigend kaputt.
    if (process.env.VERCEL) { const e = new Error('Redis ist nicht konfiguriert (KV_REST_API_URL/KV_REST_API_TOKEN fehlen)'); e.status = 503; throw e; }
    return cmds.map(memExec);
  }
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('Redis: ' + JSON.stringify(j));
  return j.map((x) => { if (x.error) throw new Error('Redis: ' + x.error); return x.result; });
}

// HGETALL liefert [k1, v1, k2, v2, ...] -> Objekt
function obj(flat) {
  const o = {};
  if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
}

module.exports = { pipeline, obj, usingRedis: () => !!URL_ };
