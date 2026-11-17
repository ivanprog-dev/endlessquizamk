'use strict';
// Lokaler Server: statische Dateien + die beiden API-Handler. Ohne KV_REST_API_URL läuft der In-Memory-Store.
const http = require('http'), fs = require('fs'), path = require('path'), { URL } = require('url');
const room = require('./api/room'), state = require('./api/state');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function wrap(res) { res.status = (c) => { res.statusCode = c; return res; }; res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); }; return res; }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); wrap(res);
  if (u.pathname === '/api/state') { req.query = Object.fromEntries(u.searchParams); return state(req, res); }
  if (u.pathname === '/api/room') {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { req.body = b; room(req, res); }); return;
  }
  const f = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
});
const port = process.env.PORT || 3000;
if (require.main === module) server.listen(port, () => console.log('http://localhost:' + port));
module.exports = server;
