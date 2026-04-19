const axios = require('axios');
const {
  calculateRSI,    getRSISignal,
  calculateMACD,   getMACDSignal,  getZoneLabel,
  calculateRVOL,   getRVOLSignal,
  calculateATR,    calculateCHG,
  calculateWick,   calculateBDR,
  calculatePWR,    calculateFASE,
  calculateAKSI,   calculateTPSL,
  calculateEntry
} = require('./indicators');

const WATCHLIST = [
  'AHAP', 'ARCI', 'BBYB', 'BIPI', 'BNBR',
  'BRMS', 'BULL', 'BUMI', 'BUVA', 'BWPT',
  'COCO', 'COIN', 'CUAN', 'DATA', 'DEWA',
  'DOOH', 'EMAS', 'ENRG', 'GTSI', 'HUMI',
  'IMPC', 'INDY', 'KBLV', 'KETR', 'KLAS',
  'KPIG', 'MBMA', 'MINA', 'NINE', 'OASA',
  'PADA', 'PADI', 'PANI', 'PBSA', 'PNLF',
  'PSKT', 'PTRO', 'RAJA', 'SOCI', 'SOFA',
  'SUPA', 'TAPG', 'TOBA', 'TPIA', 'TRIN',
  'TRUE', 'VKTR', 'WIFI', 'WMUU', 'ZATA',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://finance.yahoo.com',
  'Origin': 'https://finance.yahoo.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

function getUrls(symbol) {
  return [
    `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`
  ];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchData(ticker) {
  const symbol = `${ticker}.JK`;
  const urls   = getUrls(symbol);

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await axios.get(urls[i], {
        headers: HEADERS,
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

      const price     = meta.regularMarketPrice || closes[closes.length - 1];
      const prevClose = meta.previousClose      || closes[closes.length - 2];

      return { closes, highs, lows, volumes, price, prevClose };

    } catch (err) {
      console.log(`Gagal URL ${i+1} untuk ${ticker}: ${err.message}`);
      await sleep(1000);
      continue;
    }
  }

  return null;
}

async function screenStock(ticker) {
  const data = await fetchData(ticker);
  if (!data) return { ticker, ok: false, error: 'Gagal fetch semua URL' };

  const { closes, highs, lows, volumes, price, prevClose } = data;

  const rsi                                              = calculateRSI(closes);
  const { macd, signal: macdSig, hist,
          macdPrev, signalPrev,
          goldenCross, deathCross, zone }                = calculateMACD(closes);
  const rvol                                             = calculateRVOL(volumes);
  const atr                                              = calculateATR(highs, lows, closes);
  const chg                                              = calculateCHG(price, prevClose);
  const wick                                             = calculateWick(highs, lows, closes);
  const bdr                                              = calculateBDR(volumes, closes, rvol, rsi, wick);
  const pwr                                              = calculatePWR(rsi, macd, macdSig, rvol, chg, hist, goldenCross, deathCross);
  const fase                                             = calculateFASE(rsi, macd, macdSig, chg, wick, hist);
  const aksi                                             = calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase, goldenCross, deathCross, bdr.label, zone);
  const { tp, sl }                                       = calculateTPSL(price, atr, fase, aksi, highs, lows);
  const { e1, e2, e3 }                                   = calculateEntry(price, atr, fase, aksi, highs, lows);

  const rsiSig       = getRSISignal(rsi);
  const macdSigLabel = getMACDSignal(macd, macdSig, goldenCross, deathCross);
  const rvolSig      = getRVOLSignal(rvol);
  const zoneLabel    = getZoneLabel(zone);

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
    macdLabel:   macdSigLabel.label,
    goldenCross,
    deathCross,
    zone,
    zoneLabel,
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
  console.log('\n' + '='.repeat(70));
  console.log('SCREENER SAHAM IDX - ' + now);
  console.log('='.repeat(70));

  const results = {};
  for (const ticker of WATCHLIST) {
    process.stdout.write(`Scanning ${ticker}...\r`);
    results[ticker] = await screenStock(ticker);
    await sleep(500);
  }

  const sukses = Object.values(results).filter(r => r.ok).length;
  console.log(`\nScan selesai - ${sukses}/${WATCHLIST.length} saham berhasil\n`);

  // Summary Sinyal Beli
  console.log('─'.repeat(70));
  console.log('🟢 SINYAL BELI TERKONFIRMASI (Golden Cross / Bull Zone):');
  console.log('─'.repeat(70));
  const beliBull = Object.values(results).filter(r =>
    r.ok &&
    (r.aksi === 'HAKA' || r.aksi === 'BUY') &&
    (r.goldenCross || r.zone === 'BULL_ZONE' || r.zone === 'ZERO_CROSS_UP')
  );
  if (!beliBull.length) {
    console.log('  Tidak ada sinyal beli terkonfirmasi.');
  } else {
    beliBull.forEach(r => {
      const cross = r.goldenCross ? '🟡 GOLDEN CROSS' : r.zoneLabel;
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.aksi.padEnd(4)} | ${r.fase.padEnd(9)} | ` +
        `${cross.padEnd(22)} | PWR:${r.pwr} | RVOL:${r.rvol} | ` +
        `Harga:${r.price} | TP:${r.tp} | SL:${r.sl}`
      );
    });
  }

  // Summary Sinyal Jual
  console.log('\n' + '─'.repeat(70));
  console.log('🔴 SINYAL JUAL TERKONFIRMASI (Death Cross / Bear Zone):');
  console.log('─'.repeat(70));
  const jualBear = Object.values(results).filter(r =>
    r.ok &&
    r.aksi === 'SELL' &&
    (r.deathCross || r.zone === 'BEAR_ZONE' || r.zone === 'ZERO_CROSS_DOWN')
  );
  if (!jualBear.length) {
    console.log('  Tidak ada sinyal jual terkonfirmasi.');
  } else {
    jualBear.forEach(r => {
      const cross = r.deathCross ? '💀 DEATH CROSS' : r.zoneLabel;
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.aksi.padEnd(4)} | ${r.fase.padEnd(9)} | ` +
        `${cross.padEnd(22)} | PWR:${r.pwr} | RVOL:${r.rvol} | ` +
        `Harga:${r.price} | TP:${r.tp} | SL:${r.sl}`
      );
    });
  }

  // Summary Sinyal Ambigu
  console.log('\n' + '─'.repeat(70));
  console.log('⚠️  SINYAL AMBIGU (arah sinyal vs zone berlawanan):');
  console.log('─'.repeat(70));
  const ambigu = Object.values(results).filter(r => {
    if (!r.ok) return false;
    const beliTapiBearZone = (r.aksi === 'BUY' || r.aksi === 'HAKA') &&
                             (r.zone === 'BEAR_ZONE' || r.zone === 'ZERO_CROSS_DOWN');
    const jualTapiBullZone = r.aksi === 'SELL' &&
                             (r.zone === 'BULL_ZONE' || r.zone === 'ZERO_CROSS_UP');
    return beliTapiBearZone || jualTapiBullZone;
  });
  if (!ambigu.length) {
    console.log('  Tidak ada sinyal ambigu.');
  } else {
    ambigu.forEach(r => {
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.aksi.padEnd(4)} | ${r.fase.padEnd(9)} | ` +
        `${r.zoneLabel.padEnd(22)} | PWR:${r.pwr} | RVOL:${r.rvol} | Harga:${r.price}`
      );
    });
  }

  console.log('\n' + '='.repeat(70));
  return results;
}

module.exports = { runScreener, screenStock, WATCHLIST };
