/**
 * screener_simple.js v2 — MACD(12,26,9) + Stochastic(10,5,5)
 *
 * BUY RULES  (semua harus terpenuhi):
 *   1. Stoch golden cross dalam 3 bar
 *   2. Stoch %K saat cross < 30 (oversold)
 *   3. MACD histogram > 0 ATAU MACD line > signal
 *   4. IHSG > SMA50 (regime filter)            ← patch #1
 *   5. Avg nilai transaksi 20D ≥ Rp 5 miliar   ← patch #2
 *   6. Volume hari cross ≥ 0.8× avg vol 20D    ← patch #3
 *
 * POSITION SIZING:
 *   SL   : 1.5 × ATR(14), cap 7%              ← patch #4
 *   TP   : +10% dari entry, full exit          ← patch #5
 *   Size : max 2% risk per trade               ← patch #7
 *   Set PORTFOLIO_IDR via env var (default 100 juta)
 *
 * EXIT RULES:
 *   TP kena         : full exit
 *   SL kena         : full exit
 *   Stoch death cross DAN MACD death cross bersamaan → SELL  ← patch #6
 *   Salah satu saja → WARN (belum exit, siap-siap)
 *
 * Run standalone: node screener_simple.js
 * Import       : const { runSimpleScreener, screenSimpleStock, getLastIHSG } = require('./screener_simple')
 */

'use strict';
const axios = require('axios');
const TI    = require('technicalindicators'); // sama persis seperti complex screener

// ── Config ────────────────────────────────────────────────────────────────────
const WATCHLIST = ['AADI','ADRO','AHAP','ARCI','ASPR','ATAP','AYAM','BAIK','BBRI','BBTN',
'BBYB','BFIN','BGTG','BIPI','BMRI','BNBR','BRMS','BRPT','BULL','BUMI',
'BUVA','BWPT','CARE','CASH','COAL','COCO','CPRO','CTTH','CUAN','DATA',
'DEWA','DKFT','ELSA','ELTY','EMAS','EMTK','ENRG','ESIP','ESSA','FORE',
'GOTO','GTSI','HUMI','ICON','IMPC','INCO','INDY','JGLE','JKON','JMAS',
'JPFA','KBLV','KETR','KING','KPIG','LEAD','MAIN','MBMA','MBSS','MDKA',
'MINA','NAYZ','NINE','PADA','PADI','PANI','PPRE','PSAT','PSKT',
'PTPP','PYFA','RAJA','RLCO','SINI','SOCI','SOFA','SUPA','TAPG','TKIM','TPIA',
'TOBA','TRIN','TRUE','VKTR','WIFI','WMUU','YELO','ZATA'
];

const CFG = {
  STOCH_K:        10,
  STOCH_K_SMOOTH:  5,
  STOCH_D:         5,
  OVERSOLD:       30,
  OVERBOUGHT:     70,
  CROSS_WINDOW:    3,
  ATR_PERIOD:     14,
  ATR_MULT:      1.5,    // SL = 1.5 × ATR
  SL_CAP:        0.07,   // max 7%
  TP_PCT:        0.10,   // TP +10%
  MIN_LIQUIDITY: 5_000_000_000,   // Rp 5 miliar
  VOL_RATIO_MIN: 0.8,    // volume hari cross ≥ 0.8× avg
  RISK_PER_TRADE: 0.02,  // 2% portfolio per trade
  FETCH_RANGE:   '5y',   // Fix EMA convergence: 5y → MACD values mendekati TradingView
};

// Portfolio size — set via env variable di Railway: PORTFOLIO_IDR=500000000
const PORTFOLIO_IDR = parseInt(process.env.PORTFOLIO_IDR || '100000000');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://finance.yahoo.com',
  'Cache-Control': 'no-cache',
};

// ── Module-level IHSG cache ───────────────────────────────────────────────────
// Diisi oleh runSimpleScreener(), dipakai oleh on-demand /screener-simple/:ticker
let lastIHSGData = { bullish: true, price: null, sma50: null };

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep      = ms  => new Promise(r => setTimeout(r, ms));
const safeNum    = (x, def = 0) => Number.isFinite(x) ? x : def;
const round2     = x   => safeNum(parseFloat(x.toFixed(2)));
const fmtIDR     = n   => n >= 1e9 ? (n/1e9).toFixed(1)+'M' : n >= 1e6 ? (n/1e6).toFixed(1)+'Jt' : String(n);

function getFraksi(price) {
  if (price <  200) return 1;
  if (price <  500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}
const roundFraksi = (price, fraksi) => Math.round(price / fraksi) * fraksi;

// ── Fetch Yahoo Finance ───────────────────────────────────────────────────────
async function fetchOHLCV(symbol, range = CFG.FETCH_RANGE) {
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`,
  ];
  for (const url of urls) {
    try {
      const res   = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      const chart = res.data.chart?.result?.[0];
      if (!chart) continue;
      const q       = chart.indicators.quote[0];
      const closes  = q.close.filter(v => v != null);
      const highs   = q.high.filter(v => v != null);
      const lows    = q.low.filter(v => v != null);
      const volumes = q.volume.filter(v => v != null);
      if (closes.length < 45) continue;
      const price     = chart.meta.regularMarketPrice || closes.at(-1);
      const prevClose = chart.meta.previousClose      || closes.at(-2);
      return { closes, highs, lows, volumes, price, prevClose };
    } catch { await sleep(800); }
  }
  return null;
}

// ── PATCH #1: IHSG Regime (IHSG > SMA50) ─────────────────────────────────────
async function fetchIHSGSimple() {
  const data = await fetchOHLCV('^JKSE', '6mo');
  if (!data) {
    console.log('⚠  IHSG fetch gagal — regime filter dinonaktifkan (fail-open)');
    return { bullish: true, price: null, sma50: null };
  }
  const { closes } = data;
  if (closes.length < 50) return { bullish: true, price: Math.round(closes.at(-1)), sma50: null };

  const last50 = closes.slice(-50);
  const sma50  = last50.reduce((a, b) => a + b, 0) / 50;
  const price  = closes.at(-1);
  return {
    bullish: price > sma50,
    price:   Math.round(price),
    sma50:   Math.round(sma50),
  };
}

// ── Stochastic(10,5,5) ────────────────────────────────────────────────────────
function calculateStoch(highs, lows, closes) {
  const { STOCH_K: kp, STOCH_K_SMOOTH: ks, STOCH_D: ds } = CFG;

  // Step 1: Raw %K
  const rawK = [];
  for (let i = kp - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kp + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kp + 1, i + 1));
    rawK.push(hh === ll ? 50 : (closes[i] - ll) / (hh - ll) * 100);
  }
  // Step 2: Smooth %K
  const smoothK = [];
  for (let i = ks - 1; i < rawK.length; i++) {
    const s = rawK.slice(i - ks + 1, i + 1);
    smoothK.push(s.reduce((a, b) => a + b, 0) / ks);
  }
  // Step 3: %D
  const dArr = [];
  for (let i = ds - 1; i < smoothK.length; i++) {
    const s = smoothK.slice(i - ds + 1, i + 1);
    dArr.push(s.reduce((a, b) => a + b, 0) / ds);
  }
  const n = dArr.length;
  if (n < 2) return null;
  return { k: smoothK.slice(smoothK.length - n), d: dArr };
}

// ── MACD(12,26,9) — Library-based (sama seperti complex screener) ─────────────
// Manual EMA dihapus: hasilnya tidak akurat karena EMA path-dependent dan butuh
// data historis sangat panjang untuk konvergen ke nilai TradingView.
// Library technicalindicators memberikan hasil yang jauh lebih dekat ke TradingView.
function calculateMACD(closes) {
  try {
    const result = TI.MACD.calculate({
      values: closes,
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false
    });
    if (!result.length) return null;

    const last = result.at(-1);
    const prev = result.length >= 2 ? result.at(-2) : last;

    const mNow  = last.MACD      ?? 0;
    const sNow  = last.signal    ?? 0;
    const hNow  = last.histogram ?? 0;
    const mPrev = prev.MACD      ?? 0;
    const sPrev = prev.signal    ?? 0;
    const hPrev = prev.histogram ?? 0;

    return {
      macd:        round2(mNow),
      signal:      round2(sNow),
      hist:        round2(hNow),
      goldenCross: mPrev < sPrev && mNow >= sNow,
      deathCross:  mPrev > sPrev && mNow <= sNow,
      bullish:     mNow > sNow,
      histGrowing: hNow > hPrev,
    };
  } catch {
    return null;
  }
}

// ── PATCH #4: ATR(14) ─────────────────────────────────────────────────────────
function calculateATR(highs, lows, closes, period = CFG.ATR_PERIOD) {
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1])
    ));
  }
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── SL: 1.5 × ATR, cap 7% ────────────────────────────────────────────────────
function calcATRSL(price, atr) {
  const fraksi = getFraksi(price);
  if (!atr) return roundFraksi(price * (1 - CFG.SL_CAP), fraksi); // fallback cap
  const slATR = price - atr * CFG.ATR_MULT;
  const slCap = price * (1 - CFG.SL_CAP);
  return roundFraksi(Math.max(slATR, slCap), fraksi); // ambil yang lebih besar (SL lebih ketat)
}

// ── PATCH #5: TP +10% ─────────────────────────────────────────────────────────
function calcTP(price) {
  return roundFraksi(price * (1 + CFG.TP_PCT), getFraksi(price));
}

// ── CHG% ─────────────────────────────────────────────────────────────────────
function calcCHG(price, prevClose) {
  if (!prevClose) return 0;
  return round2((price - prevClose) / prevClose * 100);
}

// ── Cross detection dalam N bar window ───────────────────────────────────────
function detectCross(k, d, window = CFG.CROSS_WINDOW) {
  const n = k.length;
  for (let bar = 0; bar < window; bar++) {
    const i = n - 1 - bar;
    if (i < 1) break;
    if (k[i - 1] < d[i - 1] && k[i] >= d[i])
      return { type: 'GOLDEN', barsAgo: bar, kAtCross: k[i], dAtCross: d[i] };
    if (k[i - 1] > d[i - 1] && k[i] <= d[i])
      return { type: 'DEATH',  barsAgo: bar, kAtCross: k[i], dAtCross: d[i] };
  }
  return { type: null, barsAgo: null, kAtCross: null, dAtCross: null };
}

// ── PATCH #2: Liquidity check ─────────────────────────────────────────────────
function checkLiquidity(closes, volumes, lookback = 20) {
  const n = Math.min(closes.length, volumes.length, lookback);
  if (n < 10) return { ok: false, avgValue: 0, label: 'ILIKUID' };
  const c   = closes.slice(-n);
  const v   = volumes.slice(-n);
  const avg = v.reduce((sum, vol, i) => sum + vol * c[i], 0) / n;
  const label = avg >= CFG.MIN_LIQUIDITY * 2 ? 'LIKUID+'
              : avg >= CFG.MIN_LIQUIDITY     ? 'LIKUID'
              : avg >= CFG.MIN_LIQUIDITY / 2 ? 'TIPIS'
              : 'ILIKUID';
  return { ok: avg >= CFG.MIN_LIQUIDITY, avgValue: Math.round(avg), label };
}

// ── PATCH #3: Volume on cross day ─────────────────────────────────────────────
function checkVolumeOnCross(volumes, cross) {
  if (!cross || cross.type === null || cross.barsAgo === null) return true;
  const n = volumes.length;
  if (n < 22) return true; // tidak cukup data, skip

  // Volume di bar saat cross
  const volAtCross = volumes[n - 1 - cross.barsAgo];
  // Avg vol 20 hari sebelum cross bar
  const sliceEnd   = n - cross.barsAgo;
  const sliceStart = Math.max(0, sliceEnd - 20);
  const volSlice   = volumes.slice(sliceStart, sliceEnd);
  if (!volSlice.length) return true;
  const avgVol = volSlice.reduce((a, b) => a + b, 0) / volSlice.length;
  return avgVol > 0 ? volAtCross >= avgVol * CFG.VOL_RATIO_MIN : true;
}

// ── PATCH #7: Position Sizing (2% risk per trade) ─────────────────────────────
function calcPositionSize(price, sl) {
  if (!sl || sl >= price || PORTFOLIO_IDR <= 0) return null;
  const riskIDR    = PORTFOLIO_IDR * CFG.RISK_PER_TRADE;
  const slPerShare = price - sl;
  if (slPerShare <= 0) return null;
  const maxShares  = Math.floor(riskIDR / slPerShare);
  const maxLots    = Math.floor(maxShares / 100);  // 1 lot IDX = 100 saham
  if (maxLots <= 0) return { lots: 0, totalValue: 0, actualRisk: 0, actualRiskPct: 0 };
  const totalValue    = maxLots * 100 * price;
  const actualRisk    = maxLots * 100 * slPerShare;
  const actualRiskPct = round2(actualRisk / PORTFOLIO_IDR * 100);
  return { lots: maxLots, totalValue: Math.round(totalValue), actualRisk: Math.round(actualRisk), actualRiskPct };
}

// ── Signal Logic (indicator-only, tanpa filter) ────────────────────────────────
// Filter diterapkan terpisah di applyBuyFilters().
function getSignal(stoch, macd) {
  if (!stoch || !macd) return { aksi: 'NO_DATA', label: '', strength: 0, detail: '' };

  const { k, d }  = stoch;
  const kNow      = k.at(-1);
  const dNow      = d.at(-1);
  const cross     = detectCross(k, d);
  const stochDead = cross.type === 'DEATH';

  // ── PATCH #6: SELL hanya kalau KEDUANYA death cross ─────────────────────
  if (macd.deathCross && stochDead) {
    const zone = kNow > CFG.OVERBOUGHT ? 'Overbought' : 'Mid-Zone';
    return {
      aksi: 'SELL',
      label: `Dual Death Cross (${zone})`,
      strength: kNow > CFG.OVERBOUGHT ? 3 : 2,
      detail: `MACD + Stoch K:${kNow.toFixed(1)} D:${dNow.toFixed(1)} · ${cross.barsAgo === 0 ? 'Hari ini' : cross.barsAgo + ' bar lalu'}`
    };
  }

  // Salah satu death → WARN (siap-siap exit, belum eksekusi)
  if (macd.deathCross && !stochDead) {
    return {
      aksi: 'WARN',
      label: 'MACD Death — Tunggu Stoch Konfirmasi',
      strength: 1,
      detail: `MACD cross down · Stoch K:${kNow.toFixed(1)} D:${dNow.toFixed(1)} (Stoch belum death)`
    };
  }
  if (stochDead && !macd.deathCross) {
    const zone = cross.kAtCross > CFG.OVERBOUGHT ? 'Overbought' : 'Mid-Zone';
    return {
      aksi: 'WARN',
      label: `Stoch Death (${zone}) — Tunggu MACD`,
      strength: 1,
      detail: `Stoch K:${kNow.toFixed(1)} cross down · MACD belum death cross`
    };
  }

  // ── BUY signals ──────────────────────────────────────────────────────────
  if (cross.type === 'GOLDEN') {
    const fromOversold = cross.kAtCross < CFG.OVERSOLD || kNow < CFG.OVERSOLD + 5;
    const macdOk       = macd.bullish || macd.goldenCross || (macd.histGrowing && macd.hist > -1);

    if (fromOversold && macd.goldenCross) {
      return {
        aksi: 'BUY', strength: 3,
        label: 'SUPER — Stoch + MACD Golden',
        detail: `Stoch K:${kNow.toFixed(1)} dari oversold · MACD double golden`
      };
    }
    if (fromOversold && macdOk) {
      return {
        aksi: 'BUY', strength: 2,
        label: 'Stoch Oversold + MACD Bullish',
        detail: `Stoch K:${kNow.toFixed(1)} D:${dNow.toFixed(1)} · ${cross.barsAgo === 0 ? 'Cross hari ini' : cross.barsAgo + ' bar lalu'}`
      };
    }
    if (fromOversold && !macdOk) {
      return {
        aksi: 'WATCH', strength: 1,
        label: 'Stoch Oversold — Tunggu MACD',
        detail: `Stoch golden K:${kNow.toFixed(1)} · MACD belum konfirmasi (hist:${macd.hist})`
      };
    }
    if (!fromOversold && macdOk) {
      return {
        aksi: 'WATCH', strength: 1,
        label: 'Stoch Golden Mid-Zone',
        detail: `Cross di K:${cross.kAtCross?.toFixed(1)} (bukan dari oversold)`
      };
    }
  }

  // ── WATCH: mendekati oversold ─────────────────────────────────────────────
  if (kNow < 25 && kNow > dNow) {
    return { aksi: 'WATCH', strength: 1, label: 'Stoch Mendekati Oversold', detail: `K:${kNow.toFixed(1)} D:${dNow.toFixed(1)} — hampir golden` };
  }
  if (kNow < 30 && kNow < dNow && macd.bullish) {
    return { aksi: 'WATCH', strength: 1, label: 'Stoch Oversold — Belum Cross', detail: `K:${kNow.toFixed(1)} D:${dNow.toFixed(1)} · MACD sudah bullish` };
  }

  return { aksi: 'HOLD', label: '', strength: 0, detail: '' };
}

// ── Apply filters ke BUY signal (poin #1 #2 #3) ──────────────────────────────
// BEAR EXCEPTION: strength 3 (SUPER — dual golden cross dari oversold) lolos
// meskipun IHSG < SMA50. Rare event, high-quality setup.
function applyBuyFilters(signal, filters) {
  if (signal.aksi !== 'BUY') return signal; // filter hanya berlaku untuk BUY

  const blocked = [];

  // Hard filters (tidak ada exception)
  if (!filters.liquidityOk)  blocked.push(`Likuiditas ${filters.liquidityLabel}`);
  if (!filters.volumeOk)     blocked.push('Volume < 0.8× avg');

  // IHSG regime: strength 3 (SUPER) dapat exception
  if (!filters.ihsgBullish && signal.strength < 3) {
    blocked.push('IHSG < SMA50');
  }

  if (blocked.length === 0) {
    // Lolos semua filter — kalau via BEAR exception, tandai
    if (!filters.ihsgBullish) {
      return {
        ...signal,
        detail:      `⚡ BEAR OUTLIER (IHSG<SMA50) — ${signal.detail}`,
        bearOutlier: true,
      };
    }
    return signal;
  }

  return {
    ...signal,
    aksi:      'BLOCKED',
    blockedBy: blocked,
    label:     signal.label,                            // label asli tetap
    detail:    `Gagal filter: ${blocked.join(' · ')}`,
    setupOk:   true, // setup teknikal valid, tapi diblokir filter
  };
}

// ── Screen satu saham ─────────────────────────────────────────────────────────
async function screenSimpleStock(ticker, ihsgData = null) {
  const data = await fetchOHLCV(`${ticker}.JK`);
  if (!data) return { ticker, ok: false, error: 'Gagal fetch data' };

  const { closes, highs, lows, volumes, price, prevClose } = data;

  const stoch = calculateStoch(highs, lows, closes);
  const macd  = calculateMACD(closes);
  if (!stoch || !macd) return { ticker, ok: false, error: 'Data tidak cukup' };

  // Indikator tambahan
  const atr       = calculateATR(highs, lows, closes);
  const liquidity = checkLiquidity(closes, volumes);
  const cross     = detectCross(stoch.k, stoch.d);
  const volumeOk  = checkVolumeOnCross(volumes, cross);

  // Raw signal (indicator-only)
  const rawSignal = getSignal(stoch, macd);

  // Apply filters
  const ihsg   = ihsgData || lastIHSGData;
  const signal = applyBuyFilters(rawSignal, {
    ihsgBullish:   ihsg.bullish,
    liquidityOk:   liquidity.ok,
    liquidityLabel: liquidity.label,
    volumeOk,
  });

  // Risk management
  const sl    = calcATRSL(price, atr);
  const tp    = calcTP(price);
  const slPct = round2((price - sl) / price * 100);
  const tpPct = round2((tp - price) / price * 100);

  // Position sizing
  const posSize = calcPositionSize(price, sl);

  return {
    ticker, ok: true,
    price: Math.round(price),
    chg:   calcCHG(price, prevClose),
    // Stoch
    stochK:     round2(stoch.k.at(-1)),
    stochD:     round2(stoch.d.at(-1)),
    stochKPrev: round2(stoch.k.at(-2)),
    stochDPrev: round2(stoch.d.at(-2)),
    // MACD
    macd:        macd.macd,
    macdSig:     macd.signal,
    hist:        macd.hist,
    macdBullish: macd.bullish,
    macdGolden:  macd.goldenCross,
    macdDeath:   macd.deathCross,
    // Signal
    aksi:      signal.aksi,
    label:     signal.label,
    strength:  signal.strength,
    detail:    signal.detail,
    blockedBy: signal.blockedBy || [],
    setupOk:   signal.setupOk   || false,
    bearOutlier: signal.bearOutlier || false,
    // Risk management
    atr:    atr ? round2(atr) : null,
    sl, slPct, tp, tpPct,
    // Position sizing
    lots:        posSize?.lots        ?? null,
    totalValue:  posSize?.totalValue  ?? null,
    actualRisk:  posSize?.actualRisk  ?? null,
    actualRiskPct: posSize?.actualRiskPct ?? null,
    // Filter metadata
    liquidity:    liquidity.label,
    avgValueIDR:  liquidity.avgValue,
    volumeOk,
    ihsgBullish:  ihsg.bullish,
  };
}

// ── Run full screener ─────────────────────────────────────────────────────────
async function runSimpleScreener() {
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log('\n' + '═'.repeat(76));
  console.log('SCREENER SIMPLE v2 (MACD + Stoch 10,5,5) — ' + now);
  console.log(`Portfolio: Rp ${fmtIDR(PORTFOLIO_IDR)} | SL: 1.5×ATR cap 7% | TP: +10% | Risk: 2%/trade`);
  console.log('═'.repeat(76));

  // Fetch IHSG dulu untuk regime filter
  process.stdout.write('Fetching IHSG regime...\r');
  const ihsgData  = await fetchIHSGSimple();
  lastIHSGData    = ihsgData; // cache di module level
  const regimeMark = ihsgData.bullish ? '🟢' : '🔴';
  const regimeText = ihsgData.bullish
    ? 'BULLISH — filter aktif normal'
    : 'BEARISH — hanya SUPER signal (★★★) yang lolos sebagai BEAR OUTLIER';
  console.log(`${regimeMark} IHSG: ${ihsgData.price || '?'} | SMA50: ${ihsgData.sma50 || '?'} | ${regimeText}`);
  console.log('─'.repeat(76));

  const results = {};
  for (const ticker of WATCHLIST) {
    process.stdout.write(`Scanning ${ticker}...                \r`);
    results[ticker] = await screenSimpleStock(ticker, ihsgData);
    await sleep(500);
  }

  const sukses = Object.values(results).filter(r => r.ok).length;
  console.log(`\nScan selesai — ${sukses}/${WATCHLIST.length} saham berhasil\n`);

  // ─ BUY ─
  const buyList = Object.values(results)
    .filter(r => r.ok && r.aksi === 'BUY')
    .sort((a, b) => b.strength - a.strength || b.chg - a.chg);

  console.log('─'.repeat(76));
  console.log('🟢 BUY SIGNAL (lolos semua filter):');
  console.log('─'.repeat(76));
  if (!buyList.length) {
    console.log('  Tidak ada sinyal beli hari ini.');
  } else {
    buyList.forEach(r => {
      const str = '★'.repeat(r.strength);
      const lot = r.lots ? `| Lot:${r.lots} (Rp ${fmtIDR(r.totalValue)})` : '';
      console.log(`  ${r.ticker.padEnd(6)} ${str.padEnd(4)} | Harga:${r.price} | SL:${r.sl}(-${r.slPct}%) | TP:${r.tp}(+${r.tpPct}%) ${lot}`);
      console.log(`         └─ ${r.label} | K:${r.stochK} D:${r.stochD} | MACD:${r.hist>0?'+':''}${r.hist} | ${r.liquidity}`);
    });
  }

  // ─ SELL ─
  const sellList = Object.values(results)
    .filter(r => r.ok && r.aksi === 'SELL')
    .sort((a, b) => b.strength - a.strength);

  console.log('\n' + '─'.repeat(76));
  console.log('🔴 SELL SIGNAL (dual death cross terkonfirmasi):');
  console.log('─'.repeat(76));
  if (!sellList.length) {
    console.log('  Tidak ada sinyal jual.');
  } else {
    sellList.forEach(r => {
      console.log(`  ${r.ticker.padEnd(6)} ${'★'.repeat(r.strength).padEnd(4)} | Harga:${r.price} | K:${r.stochK} D:${r.stochD} | MACD:${r.hist>0?'+':''}${r.hist}`);
      console.log(`         └─ ${r.label} · ${r.detail}`);
    });
  }

  // ─ WARN ─
  const warnList = Object.values(results)
    .filter(r => r.ok && r.aksi === 'WARN')
    .sort((a, b) => b.strength - a.strength);

  console.log('\n' + '─'.repeat(76));
  console.log('🟠 WARN (satu death cross — siap-siap exit kalau holding):');
  console.log('─'.repeat(76));
  if (!warnList.length) {
    console.log('  Tidak ada warning exit.');
  } else {
    warnList.forEach(r => {
      console.log(`  ${r.ticker.padEnd(6)} | Harga:${r.price} | K:${r.stochK} D:${r.stochD} | MACD:${r.hist>0?'+':''}${r.hist}`);
      console.log(`         └─ ${r.label} · ${r.detail}`);
    });
  }

  // ─ BLOCKED ─
  const blockedList = Object.values(results)
    .filter(r => r.ok && r.aksi === 'BLOCKED')
    .sort((a, b) => b.strength - a.strength);

  console.log('\n' + '─'.repeat(76));
  console.log('🚫 BLOCKED (setup teknikal valid, tapi gagal filter):');
  console.log('─'.repeat(76));
  if (!blockedList.length) {
    console.log('  Tidak ada setup yang diblokir.');
  } else {
    blockedList.forEach(r => {
      console.log(`  ${r.ticker.padEnd(6)} ${'★'.repeat(r.strength).padEnd(4)} | ${r.label} | Harga:${r.price} | K:${r.stochK}`);
      console.log(`         └─ Diblokir: ${r.blockedBy.join(' · ')}`);
    });
  }

  // ─ WATCH ─
  const watchList = Object.values(results)
    .filter(r => r.ok && r.aksi === 'WATCH')
    .sort((a, b) => a.stochK - b.stochK);

  console.log('\n' + '─'.repeat(76));
  console.log('🟡 WATCH (belum entry, pantau):');
  console.log('─'.repeat(76));
  if (!watchList.length) {
    console.log('  Tidak ada saham yang perlu di-watch.');
  } else {
    watchList.forEach(r => {
      console.log(`  ${r.ticker.padEnd(6)} | Harga:${r.price} | K:${r.stochK} D:${r.stochD} | ${r.label}`);
    });
  }

  console.log('\n' + '═'.repeat(76) + '\n');
  return { results, ihsg: ihsgData };
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  runSimpleScreener,
  screenSimpleStock,
  WATCHLIST,
  getLastIHSG: () => lastIHSGData,
};

if (require.main === module) {
  runSimpleScreener().catch(console.error);
}
