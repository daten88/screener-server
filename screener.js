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
  'TPIA', 'TRUE', 'VKTR', 'WIFI', 'ZATA',
  'COCO', 'COIN', 'KPIG', 'TAPG', 'BWPT'
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return null;

  const rows = lines.slice(1).map(line => {
    const cols = line.split(',');
    return {
      date:   cols[0],
      open:   parseFloat(cols[1]),
      high:   parseFloat(cols[2]),
      low:    parseFloat(cols[3]),
      close:  parseFloat(cols[4]),
      volume: parseInt(cols[5]) || 0
    };
  }).filter(r => !isNaN(r.close) && r.close > 0);

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function fetchData(ticker) {
  try {
    const symbol = `${ticker.toLowerCase()}.id`;
    const url    = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;

    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://stooq.com'
      },
      timeout: 15000
    });

    const rows = parseCSV(res.data);
    if (!rows || rows.length < 30) return null;

    const recent  = rows.slice(-90);
    const closes  = recent.map(r => r.close);
    const highs   = recent.map(r => r.high);
    const lows    = recent.map(r => r.low);
    const volumes = recent.map(r => r.volume);

    const price     = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];

    return { closes, highs, lows, volumes, price, prevClose };

  } catch (err) {
    console.log(`Gagal fetch ${ticker}: ${err.message}`);
    return null;
  }
}

async function screenStock(ticker) {
  const data = await fetchData(ticker);
  if (!data) return { ticker, ok: false, error: 'Gagal fetch data' };

  const { closes, highs, lows, volumes, price, prevClose } = data;

  const rsi                                          = calculateRSI(closes);
  const { macd, signal: macdSig, hist,
          goldenCross, deathCross }                  = calculateMACD(closes);
  const rvol                                         = calculateRVOL(volumes);
  const atr                                          = calculateATR(highs, lows, closes);
  const chg                                          = calculateCHG(price, prevClose);
  const wick                                         = calculateWick(highs, lows, closes);
  const bdr                                          = calculateBDR(volumes, closes, rvol);
  const pwr                                          = calculatePWR(rsi, macd, macdSig, rvol, chg, hist, goldenCross, deathCross);
  const fase                                         = calculateFASE(rsi, macd, macdSig, chg, wick, hist);
  const aksi                                         = calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase, goldenCross, deathCross, bdr.label);
  const { tp, sl }                                   = calculateTPSL(price, atr, fase, aksi, highs, lows);
  const { e1, e2, e3 }                               = calculateEntry(price, atr, fase, aksi, highs, lows);

  const rsiSig       = getRSISignal(rsi);
  const macdSigLabel = getMACDSignal(macd, macdSig);
  const rvolSig      = getRVOLSignal(rvol);

  // Label MACD dengan Golden/Death Cross
  let macdLabel = macdSigLabel.label;
  if (goldenCross) macdLabel = 'GOLDEN CROSS';
  if (deathCross)  macdLabel = 'DEATH CROSS';

  return {
    ticker,
    ok:          true,
    price:       Math.round(price),
    chg,
    rsi,
    rsiLabel:    rsiSig.label,
    macd,
    macdSig,
    hist,
    macdLabel,
    goldenCross,
    deathCross,
    rvol,
    rvolLabel:   rvolSig.label,
    bdr:         bdr.label,
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
    await sleep(500);
  }

  const sukses = Object.values(results).filter(r => r.ok).length;
  console.log(`\nScan selesai - ${sukses}/${WATCHLIST.length} saham berhasil`);
  return results;
}

module.exports = { runScreener, screenStock, WATCHLIST };
