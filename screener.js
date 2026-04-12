const axios = require('axios');
const {
  calculateRSI, getRSISignal,
  calculateMACD, getMACDSignal,
  calculateRVOL, getRVOLSignal,
  calculateBDR, getFinalSignal
} = require('./indicators');

// ===== WATCHLIST =====
const WATCHLIST = [
  'AHAP', 'ARCI', 'BIPI', 'BNBR', 'BRMS',
  'BULL', 'BUMI', 'BUVA', 'CUAN', 'DATA',
  'DEWA', 'ENRG', 'GTSI', 'HUMI', 'INDY',
  'IMPC', 'MBMA', 'MINA', 'NINE', 'PADA',
  'PADI', 'PANI', 'PSKT', 'RAJA', 'SOFA',
  'TPIA', 'TRUE', 'VKTR', 'WIFI', 'ZATA'
];

// ===== FETCH DATA =====
async function fetchData(ticker) {
  try {
    const symbol = `${ticker}.JK`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const chart = res.data.chart.result[0];
    const quote = chart.indicators.quote[0];
    const closes  = quote.close.filter(v => v !== null);
    const volumes = quote.volume.filter(v => v !== null);

    if (closes.length < 30) return null;

    return {
      closes,
      volumes,
      currentPrice: closes[closes.length - 1]
    };
  } catch (err) {
    console.log(`❌ Gagal fetch ${ticker}: ${err.message}`);
    return null;
  }
}

// ===== SCREEN 1 SAHAM =====
async function screenStock(ticker) {
  const data = await fetchData(ticker);
  if (!data) return null;

  const { closes, volumes, currentPrice } = data;

  const rsi            = calculateRSI(closes);
  const { macd, prev } = calculateMACD(closes);
  const rvol           = calculateRVOL(volumes);
  const bdr            = calculateBDR(closes, rvol);

  const rsiSig  = getRSISignal(rsi);
  const macdSig = getMACDSignal(macd, prev);
  const rvolSig = getRVOLSignal(rvol);

  const signal = getFinalSignal(
    rsiSig.score, macdSig.score,
    rvolSig.score, bdr.score,
    macd
  );

  return {
    ticker,
    price:     Math.round(currentPrice),
    rsi,
    rsiLabel:  rsiSig.label,
    macd,
    macdLabel: macdSig.label,
    rvol,
    rvolLabel: rvolSig.label,
    bdr:       bdr.label,
    signal
  };
}

// ===== SCREEN SEMUA =====
async function runScreener() {
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log('\n' + '='.repeat(50));
  console.log('📊 SCREENER SAHAM IDX');
  console.log(`🕐 ${now} WIB`);
  console.log(`📋 Total Watchlist: ${WATCHLIST.length} saham`);
  console.log('='.repeat(50) + '\n');

  const results = [];

  for (const ticker of WATCHLIST) {
    process.stdout.write(`🔍 Scanning ${ticker}...\r`);
    const result = await screenStock(ticker);
    if (result) results.push(result);
  }

  const order = { '🚀 HAKA': 0, '✅ BUY': 1, '🟡 HOLD': 2, '🔴 SELL': 3 };
  results.sort((a, b) => (order[a.signal] ?? 9) - (order[b.signal] ?? 9));

  console.log('\n' + '='.repeat(50));
  console.log('📊 HASIL SCREENER');
  console.log('='.repeat(50));

  for (const r of results) {
    console.log(`\n${'━'.repeat(35)}`);
    console.log(`📌 ${r.ticker} | Harga: Rp${r.price.toLocaleString('id-ID')}`);
    console.log(`   RSI  : ${r.rsi} → ${r.rsiLabel}`);
    console.log(`   MACD : ${r.macd} → ${r.macdLabel}`);
    console.log(`   RVOL : ${r.rvol}x → ${r.rvolLabel}`);
    console.log(`   BDR  : ${r.bdr}`);
    console.log(`   ⚡ SINYAL: ${r.signal}`);
  }

  console.log('\n' + '='.repeat(50) + '\n');
  return results;
}

module.exports = { runScreener, screenStock, WATCHLIST };