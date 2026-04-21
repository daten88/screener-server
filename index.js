const express = require('express');
const cron    = require('node-cron');
const { runScreener, screenStock, fetchIHSG, WATCHLIST } = require('./screener');

const app  = express();
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

// ── State ──────────────────────────────────────────────────────────────
// Patch v2: `latestData` dipecah jadi 2 variabel.
// `latestResults` = object per ticker (struktur sama seperti v1)
// `latestRegime`  = info market regime IHSG (baru di v2)
let latestResults = {};
let latestRegime  = { regime:'UNKNOWN', rsi:50, price:null, sma50:null, sma200:null };
let lastScanTime  = null;
let isRefreshing  = false;

async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  console.log('Refreshing semua saham...');
  try {
    // Patch v2: runScreener() sekarang return { results, regimeInfo }
    const { results, regimeInfo } = await runScreener();
    latestResults = results;
    latestRegime  = regimeInfo;
    lastScanTime  = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log('Refresh selesai: ' + lastScanTime + ' | IHSG: ' + regimeInfo.regime);
  } catch (err) {
    // Patch v2: error handling biar tidak deadlock kalau runScreener throw
    console.error('Refresh GAGAL:', err.message);
  } finally {
    isRefreshing = false;
  }
}

// Scan otomatis setiap 2 menit jam bursa
cron.schedule('*/2 9-15 * * 1-5', async () => {
  await refreshAll();
}, { timezone: 'Asia/Jakarta' });

// ── ENDPOINTS ──────────────────────────────────────────────────────────

// GET /data — kompatibel dengan v1 frontend, plus field `regime` baru
app.get('/data', (req, res) => {
  res.json({
    data:     latestResults,   // ← struktur sama seperti v1 (object per ticker)
    regime:   latestRegime,    // ← baru: info regime IHSG
    ts:       Date.now(),
    lastScan: lastScanTime
  });
});

// GET /regime — khusus fetch regime IHSG
app.get('/regime', (req, res) => {
  res.json({ regime: latestRegime, ts: Date.now() });
});

app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    stocks:   Object.keys(latestResults).length,
    regime:   latestRegime.regime,
    lastScan: lastScanTime
  });
});

// GET /screener/:ticker — on-demand scan 1 saham
// Patch v2: wajib pass regimeInfo, fallback fetch kalau belum ada
app.get('/screener/:ticker', async (req, res) => {
  try {
    // Kalau regime belum di-cache (server baru start, belum cron pertama),
    // fetch cepat ditempat biar filter v2 tetap bekerja.
    let regimeInfo = latestRegime;
    if (regimeInfo.regime === 'UNKNOWN') {
      regimeInfo = await fetchIHSG();
      latestRegime = regimeInfo;  // cache
    }

    const result = await screenStock(req.params.ticker.toUpperCase(), regimeInfo);
    if (!result) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── START SERVER ───────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('Server berjalan di port ' + PORT);
  await refreshAll();
});
