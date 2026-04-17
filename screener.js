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

const ALPHA_KEY = process.env.ALPHA_KEY || '';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchAlphaVantage(ticker) {
  try {
    const symbol = `${ticker}.JK`;
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${ALPHA_KEY}`;

    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data;

    if (data['Note'] || data['Information']) {
      console.log(`Alpha Vantage limit untuk ${ticker}`);
      return null;
    }

    const ts = data['Time Series (Daily)'];
    if (!ts) return null;

    const dates = Object.keys(ts).sort();
    if (dates.length < 30) return null;

    const recent  = dates.slice(-90);
    const closes  = recent.map(d => parseFloat(ts[d]['4. close']));
    const highs   = recent.map(d => parseFloat(ts[d]['2. high']));
    const lows    = recent.map(d => parseFloat(ts[d]['3. low']));
    const volumes = recent.map(d => parseFloat(ts[d]['5. volume']));

    const price     = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];

    return { closes, highs, lows, volumes, price, prevClose };
  } catch (err) {
    return null;
  }
}

async function fetchStooq(ticker) {
  try {
    const symbol = `${ticker.toLowerCase()}.id`;
    const url    = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;

    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://stooq.com'
      },
      timeout: 15000
    });

    const lines = res.data.trim().split('\n');
    if (lines.length < 2) return null;

    const rows = lines.slice(1).map(line => {
      const cols = line.split(',');
      return {
        date:   cols[0],
        high:   parseFloat(cols[2]),
        low:    parseFloat(cols[3]),
        close:  parseFloat(cols[4]),
        volume: parseInt(cols[5]) || 0
      };
    }).filter(r => !isNaN(r.close) && r.close > 0);

    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 30) return null;

    const recent  = rows.slice(-90);
    const closes  = recent.map(r => r.close);
    const highs   = recent.map(r => r.high);
    const lows    = recent.map(r => r.low);
    const volumes = recent.map(r => r.volume);

    return {
      closes, highs, lows, volumes,
      price:     closes[closes.length - 1],
      prevClose: closes[closes.length - 2]
    };
  } catch (err) {
    return null;
  }
}

async function fetchYahoo(ticker) {
  try {
    const symbol = `${ticker}.JK`;
    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`
    ];

    for (const url of urls) {
      try {
        const res = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://finance.yahoo.com'
          },
          timeout: 15000
        });

        const chart = res.data.chart?.result?.[0];
        if (!chart) continue;

        const meta    = chart.meta;
        const quote   = chart.indicators.quote[0];
        const closes  = quote.close.filter(v  => v != null);
        const highs   = quote.high.filter(v   => v != null);
        const lows    = quote.low.filter(v    => v != null);
        const volumes = quote.volume.filter(v => v != null);

        if (closes.length < 30) continue;

        return {
          closes, highs, lows, volumes,
          price:     meta.regularMarketPrice || closes[closes.length - 1],
          prevClose: meta.previousClose      || closes[closes.length - 2]
        };
      } catch { continue; }
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchData(ticker) {
  // Coba Yahoo dulu
  let data = await fetchYahoo(ticker);
  if (data) return data;

  await sleep(500);

  // Coba Stooq
  data = await fetchStooq(ticker);
  if (data) return data;

  await sleep(500);

  // Coba Alpha Vantage jika ada API key
  if (ALPHA_KEY) {
    data = await fetchAlphaVantage(ticker);
    if (data) return data;
  }

  return null;
}

async function screenStock(ticker) {
  const data = await fetchData(ticker);
  if (!data) return { ticker, ok: false, error: 'Gagal fetch data' };

  const { closes, highs, lows, volumes, price, prevClose } = data;

  const rsi                                      = calculateRSI(closes);
  const { macd, signal: macdSig, hist,
          goldenCross, deathCross }               = calculateMACD(closes);
  const rvol                                     = calculateRVOL(volumes);
  const atr                                      = calculateATR(highs, lows, closes);
  const chg                                      = calculateCHG(price, prevClose);
  const wick                                     = calculateWick(highs, lows, closes);
  const bdr                                      = calculateBDR(volumes, closes, rvol);
  const pwr                                      = calculatePWR(rsi, macd, macdSig, rvol, chg, hist, goldenCross, deathCross);
  const fase                                     = calculateFASE(rsi, macd, macdSig, chg, wick, hist);
  const aksi                                     = calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase, goldenCross, deathCross, bdr.label);
  const { tp, sl }                               = calculateTPSL(price, atr, fase, aksi, highs, lows);
  const { e1, e2, e3 }                           = calculateEntry(price, atr, fase, aksi, highs, lows);

  const rsiSig       = getRSISignal(rsi);
  const macdSigLabel = getMACDSignal(macd, macdSig);
  const rvolSig      = getRVOLSignal(rvol);

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
    await sleep(1000);
  }

  const sukses = Object.values(results).filter(r => r.ok).length;
  console.log(`\nScan selesai - ${sukses}/${WATCHLIST.length} saham berhasil`);
  return results;
}

module.exports = { runScreener, screenStock, WATCHLIST };
