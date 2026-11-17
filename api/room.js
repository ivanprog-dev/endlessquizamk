'use strict';
const g = require('../lib/game');

const actions = {
  create: g.createRoom, join: g.joinRoom, start: g.startGame,
  answer: g.answer, next: g.next, again: g.again, leave: g.leaveRoom,
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST erwartet' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fn = actions[body.action];
    if (!fn) return res.status(400).json({ error: 'Unbekannte Aktion' });
    res.status(200).json(await fn(body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Serverfehler' });
    if (!e.status) console.error(e);
  }
};
