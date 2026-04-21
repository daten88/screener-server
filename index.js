const express = require('express');
const cron    = require('node-cron');
const { runScreener, screenStock, WATCHLIST } = require('./screener');

const app  = express();
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

let latestData   = {};
let lastScanTime = null;
let isRefreshing = false;

async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  console.log('Refreshing semua saham...');
  latestData   = await runScreener();
  lastScanTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  isRefreshing = false;
  console.log('Refresh selesai: ' + lastScanTime);
}

// Scan otomatis setiap 2 menit jam bursa
cron.schedule('*/2 9-15 * * 1-5', async () => {
  await refreshAll();
}, { timezone: 'Asia/Jakarta' });

// ===== ENDPOINTS =====

app.get('/data', (req, res) => {
  res.json({ data: latestData, ts: Date.now(), lastScan: lastScanTime });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', stocks: Object.keys(latestData).length, lastScan: lastScanTime });
});

app.get('/screener/:ticker', async (req, res) => {
  try {
    const result = await screenStock(req.params.ticker.toUpperCase());
    if (!result) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== START SERVER =====
app.listen(PORT, async () => {
  console.log('Server berjalan di port ' + PORT);
  await refreshAll();
});