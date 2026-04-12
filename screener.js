const axios = require('axios');
const {
  calculateRSI,  getRSISignal,
  calculateMACD, getMACDSignal,
  calculateRVOL, getRVOLSignal,
  calculateATR,  calculateCHG,
  calculateWick, calculateBDR,
  calculatePWR,  calculateFASE,
  calculateAKSI, calculateTPSL,
  calculateEntry
} = require('./indicators');

const WATCHLIST = [
  'AHAP', 'ARCI', 'BIPI', 'BNBR', 'BRMS',
  'BULL', 'BUMI', 'BUVA', 'CUAN', 'DATA',
  'DEWA', 'ENRG', 'GTSI', 'HUMI', 'INDY',
  'IMPC', 'MBMA', 'MINA', 'NINE', 'PADA',
  'PADI', 'PANI', 'PSKT', 'RAJA', 'SOFA',
  'TPIA', 'TRUE', 'VKTR', 'WIFI', 'ZATA'
];

async function fetchData(ticker) {
  try {
    const symbol = `${ticker}.JK`;
    const url    = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
    const res    = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com'
      },
      timeout: 10000
    });

    const chart  = res.data.chart.result[0];
    const meta   = chart.meta;
    const quote  = chart.indicators.quote[0];
    const closes  = quote.close.filter(v  => v != null);
    const highs   = quote.high.filter(v   => v != null);
    const lows    = quote.low.filter(v    => v != null);
    const volumes = quote.volume.filter(v => v != null);

    if (closes.length < 30) return { ticker, ok: false, error: 'Data kurang' };

    const price     = meta.regularMarketPrice || closes[closes.length - 1];
    const prevClose = meta.previousClose      || closes[closes.length - 2];

    return { closes, highs, lows, volumes, price, prevClose };
  } catch (err) {
    return null;
  }
}

async function screenStock(ticker) {
  const data = await fetchData(ticker);
  if (!data || data.ok === false) return { ticker, ok: false, error: data?.error || 'Gagal fetch' };

  const { closes, highs, lows, volumes, price, prevClose } = data;

  // Hitung semua indikator
  const rsi              = calculateRSI(closes);
  const { macd, signal: macdSig, hist } = calculateMACD(closes);
  const rvol             = calculateRVOL(volumes);
  const atr              = calculateATR(highs, lows, closes);
  const chg              = calculateCHG(price, prevClose);
  const wick             = calculateWick(highs, lows, closes);
  const bdr              = calculateBDR(volumes, closes, rvol);
  const pwr              = calculatePWR(rsi, macd, macdSig, rvol, chg, hist);
  const fase             = calculateFASE(rsi, macd, macdSig, chg, wick, hist);
  const aksi             = calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase);
  const { tp, sl }     = calculateTPSL(price, atr, fase, aksi, highs, lows);
  const { e1, e2, e3 } = calculateEntry(price, atr, fase, aksi, highs, lows);

  const rsiSig  = getRSISignal(rsi);
  const macdSigLabel = getMACDSignal(macd, macdSig);
  const rvolSig = getRVOLSignal(rvol);

return {
    ticker,
    ok:        true,
    price:     Math.round(price),
    chg,
    rsi,
    rsiLabel:  rsiSig.label,
    macd,
    macdSig,
    hist,
    macdLabel: macdSigLabel.label,
    rvol,
    rvolLabel: rvolSig.label,
    bdr:       bdr.label,
    pwr,
    fase,
    aksi,
    tp,
    sl,
    e1,
    e2,
    e3
  };
}

async function runScreener() {
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log('\n' + '='.repeat(50));
  console.log('SCREENER SAHAM IDX - ' + now);
  console.log('='.repeat(50));

  const results = {};
  for (const ticker of WATCHLIST) {
    process.stdout.write(`Scanning ${ticker}...\r`);
    results[ticker] = await screenStock(ticker);
  }

  console.log('\nScan selesai - ' + Object.keys(results).length + ' saham');
  return results;
}

module.exports = { runScreener, screenStock, WATCHLIST };