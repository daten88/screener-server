const express = require('express');
const cron    = require('node-cron');
const { runScreener, screenStock, WATCHLIST } = require('./screener');

const app  = express();
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

let lastResults  = [];
let lastScanTime = null;

cron.schedule('0,30 9-15 * * 1-5', async () => {
  console.log('Jadwal scan berjalan...');
  lastResults  = await runScreener();
  lastScanTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}, { timezone: 'Asia/Jakarta' });

app.get('/', (req, res) => {
  res.json({
    status:     'Bot Screener Saham Aktif',
    lastScan:   lastScanTime ?? 'Belum scan',
    totalSaham: WATCHLIST.length,
    watchlist:  WATCHLIST,
    endpoints: {
      '/screener':         'Scan semua watchlist',
      '/screener/:ticker': 'Scan 1 saham spesifik',
      '/hasil':            'Lihat hasil scan terakhir',
      '/hasil/haka':       'Filter sinyal HAKA',
      '/hasil/buy':        'Filter sinyal BUY',
      '/hasil/sell':       'Filter sinyal SELL'
    }
  });
});

app.get('/screener', async (req, res) => {
  try {
    const results = await runScreener();
    lastResults   = results;
    lastScanTime  = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/screener/:ticker', async (req, res) => {
  try {
    const result = await screenStock(req.params.ticker.toUpperCase());
    if (!result) {
      return res.status(404).json({ error: 'Data tidak ditemukan' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/hasil', (req, res) => {
  if (!lastResults.length) {
    return res.json({ message: 'Belum ada hasil scan' });
  }
  res.json({
    lastScan: lastScanTime,
    total:    lastResults.length,
    data:     lastResults
  });
});

app.get('/hasil/haka', (req, res) => {
  const filtered = lastResults.filter(r => r.signal === 'HAKA');
  res.json({
    lastScan: lastScanTime,
    total:    filtered.length,
    data:     filtered
  });
});

app.get('/hasil/buy', (req, res) => {
  const filtered = lastResults.filter(r => r.signal === 'BUY');
  res.json({
    lastScan: lastScanTime,
    total:    filtered.length,
    data:     filtered
  });
});

app.get('/hasil/sell', (req, res) => {
  const filtered = lastResults.filter(r => r.signal === 'SELL');
  res.json({
    lastScan: lastScanTime,
    total:    filtered.length,
    data:     filtered
  });
});

app.listen(PORT, async () => {
  console.log('Server berjalan di port ' + PORT);
  lastResults  = await runScreener();
  lastScanTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
});
