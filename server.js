const path = require('path');
const express = require('express');
require('dotenv').config();

const puzzlesHandler = require('./api/puzzles/[type].js');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const staticRoot = __dirname;

app.set('trust proxy', true);

app.get('/api/puzzles/:type', async (req, res, next) => {
  try {
    await puzzlesHandler(req, res);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(staticRoot, { extensions: ['html'] }));

app.use((req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }
  res.sendFile(path.join(staticRoot, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Gokuro webapp listening on http://${HOST}:${PORT}`);
});
