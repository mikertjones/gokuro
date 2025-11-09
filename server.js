const path = require('path');
const express = require('express');
require('dotenv').config();


const fs = require('fs');
const https = require('https');




const puzzlesHandler = require('./api/puzzles/[type].js');
const syncHandler = require('./api/sync.js');
const syncBulkHandler = require('./api/sync-bulk.js');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const staticRoot = __dirname;

app.use(express.static('public'));


app.set('trust proxy', true);

app.get('/api/puzzles/:type', async (req, res, next) => {
  try {
    await puzzlesHandler(req, res);
  } catch (error) {
    next(error);
  }
});

app.post('/api/sync', express.json(), (req, res, next) =>
  Promise.resolve(syncHandler(req, res)).catch(next)
);
app.post('/api/sync-bulk', express.json(), (req, res, next) =>
  Promise.resolve(syncBulkHandler(req, res)).catch(next)
);
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


https.createServer(
  {
    key: fs.readFileSync('./certs/192.168.0.25-key.pem'),
    cert: fs.readFileSync('./certs/192.168.0.25.pem'),
  },
  app
).listen(3000, () => {
  console.log('HTTPS server running at https://192.168.0.25:3000');
});

/*app.listen(PORT, HOST, () => {
  console.log(`Gokuro webapp listening on http://${HOST}:${PORT}`);
});
*/