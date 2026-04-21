const express = require('express');
const cron    = require('node-cron');
const { runScreener, screenStock, fetchIHSG, WATCHLIST }                         = require('./screener');
const { runSimpleScreener, screenSimpleStock, getLastIHSG, WATCHLIST: WL_SIMPLE } = require('./screener_simple');

const app  = express();
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

// ── State: Complex Screener (v2) ───────────────────────────────────────────
let latestResults = {};
let latestRegime  = { regime:'UNKNOWN', rsi:50, price:null, sma50:null, sma200:null };
let lastScanTime  = null;
let isRefreshing  = false;

// ── State: Simple Screener ─────────────────────────────────────────────────
let simpleResults      = {};
let simpleLastScan     = null;
let isSimpleRefreshing = false;

// ── Refresh: Complex ──────────────────────────────────────────────────────
async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  console.log('[Complex] Refreshing...');
  try {
    const { results, regimeInfo } = await runScreener();
    latestResults = results;
    latestRegime  = regimeInfo;
    lastScanTime  = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log('[Complex] Selesai: ' + lastScanTime + ' | IHSG: ' + regimeInfo.regime);
  } catch (err) {
    console.error('[Complex] GAGAL:', err.message);
  } finally {
    isRefreshing = false;
  }
}

// ── Refresh: Simple ────────────────────────────────────────────────────────
async function refreshSimple() {
  if (isSimpleRefreshing) return;
  isSimpleRefreshing = true;
  console.log('[Simple] Refreshing...');
  try {
    const { results } = await runSimpleScreener(); // ihsg di-cache di module
    simpleResults  = results;
    simpleLastScan = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log('[Simple] Selesai: ' + simpleLastScan);
  } catch (err) {
    console.error('[Simple] GAGAL:', err.message);
  } finally {
    isSimpleRefreshing = false;
  }
}

// ── Cron: setiap 2 menit jam bursa, offset 1 menit antar screener ─────────
cron.schedule('*/2 9-15 * * 1-5',    refreshAll,    { timezone: 'Asia/Jakarta' });
cron.schedule('1-59/2 9-15 * * 1-5', refreshSimple, { timezone: 'Asia/Jakarta' });

// ═══ ENDPOINTS: Complex Screener (v2) ════════════════════════════════════════

app.get('/data', (req, res) => {
  res.json({ data: latestResults, regime: latestRegime, ts: Date.now(), lastScan: lastScanTime });
});

app.get('/regime', (req, res) => {
  res.json({ regime: latestRegime, ts: Date.now() });
});

app.get('/health', (req, res) => {
  res.json({
    status:      'ok',
    stocks:      Object.keys(latestResults).length,
    regime:      latestRegime.regime,
    lastScan:    lastScanTime,
    simpleLastScan,
    portfolio:   parseInt(process.env.PORTFOLIO_IDR || '100000000'),
  });
});

app.get('/screener/:ticker', async (req, res) => {
  try {
    let regimeInfo = latestRegime;
    if (regimeInfo.regime === 'UNKNOWN') {
      regimeInfo = await fetchIHSG();
      latestRegime = regimeInfo;
    }
    const result = await screenStock(req.params.ticker.toUpperCase(), regimeInfo);
    if (!result) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ ENDPOINTS: Simple Screener ══════════════════════════════════════════════

app.get('/data-simple', (req, res) => {
  res.json({
    data:      simpleResults,
    ihsg:      getLastIHSG(),          // ← kirim IHSG simple ke frontend
    portfolio: parseInt(process.env.PORTFOLIO_IDR || '100000000'),
    ts:        Date.now(),
    lastScan:  simpleLastScan,
  });
});

app.get('/screener-simple/:ticker', async (req, res) => {
  try {
    // Pakai IHSG yang di-cache oleh runSimpleScreener, kalau belum ada fetch baru
    const ihsgData = getLastIHSG()?.price ? getLastIHSG() : null;
    const result = await screenSimpleStock(req.params.ticker.toUpperCase(), ihsgData);
    if (!result) return res.status(404).json({ error: 'Data tidak ditemukan' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('Server berjalan di port ' + PORT);
  console.log('Portfolio: Rp ' + parseInt(process.env.PORTFOLIO_IDR || '100000000').toLocaleString('id-ID'));
  await Promise.all([ refreshAll(), refreshSimple() ]);
});
