'use strict';
const g = require('../lib/game');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { code, pid } = req.query || {};
    res.status(200).json(await g.state({ code, pid }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Serverfehler' });
    if (!e.status) console.error(e);
  }
};
