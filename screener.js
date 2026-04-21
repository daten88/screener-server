const axios = require('axios');
const {
  calculateRSI, getRSISignal,
  calculateMACD, getMACDSignal, getZoneLabel,
  calculateRVOL, getRVOLSignal,
  calculateATR, calculateCHG,
  calculateWick, calculateBDR,
  calculatePWR, calculateFASE,
  calculateAKSI, calculateTPSL, calculateEntry,
  // ── Patch v2 ──
  calculateLiquidity, getLiquidityStatus,
  calculateRegime, applyFilters
} = require('./indicators');

const WATCHLIST = ['AHAP','ARCI','BGTG','BIPI','BNBR','BRMS','BULL','BUMI','BUVA','BWPT',
'COCO','CUAN','DATA','DEWA','DKFT','EMAS','EMTK','ENRG','GOTO','GTSI',
'HUMI','IMPC','INCO','INDY','JPFA','KETR','KPIG','MBMA','MBSS','MDKA',
'MINA','NINE','PADA','PADI','PANI','PSAT','PSKT','PYFA','RAJA','SINI',
'SOFA','SUPA','TAPG','TKIM','TPIA','TRIN','TRUE','VKTR','WIFI','ZATA'];

// ── Config ──────────────────────────────────────────────────────────────
const MIN_LIQUIDITY_IDR = 5_000_000_000;  // Rp 5 miliar/hari avg value
const FETCH_RANGE       = '5y';  // Fix EMA convergence: 5y ≈ 1260 bar → EMA fully converged, MACD mendekati TradingView

const HEADERS = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':'application/json, text/plain, */*',
  'Accept-Language':'en-US,en;q=0.9',
  'Accept-Encoding':'gzip, deflate, br',
  'Referer':'https://finance.yahoo.com',
  'Origin':'https://finance.yahoo.com',
  'Cache-Control':'no-cache',
  'Pragma':'no-cache'
};

function getUrls(symbol, range=FETCH_RANGE){
  return [
    `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`
  ];
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// ── Generic fetch (bisa untuk saham .JK maupun indeks seperti ^JKSE) ───
async function fetchDataRaw(symbol, range=FETCH_RANGE){
  const urls = getUrls(symbol, range);
  for(let i=0; i<urls.length; i++){
    try{
      const res = await axios.get(urls[i], { headers:HEADERS, timeout:15000 });
      const chart = res.data.chart?.result?.[0];
      if(!chart) continue;

      const meta    = chart.meta;
      const quote   = chart.indicators.quote[0];
      const closes  = quote.close.filter(v => v != null);
      const highs   = quote.high.filter(v => v != null);
      const lows    = quote.low.filter(v => v != null);
      const volumes = quote.volume.filter(v => v != null);

      if(closes.length < 30) continue;

      const price     = meta.regularMarketPrice || closes[closes.length-1];
      const prevClose = meta.previousClose      || closes[closes.length-2];

      return { closes, highs, lows, volumes, price, prevClose };
    }catch(err){
      console.log(`  Gagal URL ${i+1} untuk ${symbol}: ${err.message}`);
      await sleep(1000);
      continue;
    }
  }
  return null;
}

async function fetchData(ticker){
  return fetchDataRaw(`${ticker}.JK`);
}

// ── FIX #4: Fetch IHSG untuk market regime ───────────────────────────────
async function fetchIHSG(){
  const data = await fetchDataRaw('^JKSE');
  if(!data){
    console.log('⚠️  Gagal fetch IHSG — regime filter dinonaktifkan');
    return { regime:'UNKNOWN', rsi:50, price:null, sma50:null, sma200:null };
  }
  return calculateRegime(data.closes);
}

// ── Screen satu saham + apply patch v2 filters ──────────────────────────
async function screenStock(ticker, regimeInfo){
  const data = await fetchData(ticker);
  if(!data) return { ticker, ok:false, error:'Gagal fetch semua URL' };

  const { closes, highs, lows, volumes, price, prevClose } = data;

  // ── Indikator teknikal standar ─────────────────────────────────────
  const rsi  = calculateRSI(closes);
  const { macd, signal:macdSig, hist, histPrev, macdPrev, signalPrev, goldenCross, deathCross, zone } = calculateMACD(closes);
  const rvol = calculateRVOL(volumes);
  const atr  = calculateATR(highs, lows, closes);
  const chg  = calculateCHG(price, prevClose);
  const wick = calculateWick(highs, lows, closes);
  const bdr  = calculateBDR(volumes, closes, rvol, rsi, wick);
  const pwr  = calculatePWR(rsi, macd, macdSig, rvol, chg, hist, goldenCross, deathCross);
  const fase = calculateFASE(rsi, macd, macdSig, chg, wick, hist);
  const aksiRaw = calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase, goldenCross, deathCross, bdr.label, zone);

  const { tp, sl } = calculateTPSL(price, atr, fase, aksiRaw, highs, lows);
  const { e1, e2, e3 } = calculateEntry(price, atr, fase, aksiRaw, highs, lows);

  // ── FIX #1: Likuiditas ─────────────────────────────────────────────
  const liquidity       = calculateLiquidity(closes, volumes);
  const liquidityStatus = getLiquidityStatus(liquidity, MIN_LIQUIDITY_IDR);

  // ── Apply fix #1-5 sebagai post-processor ─────────────────────────
  const filtered = applyFilters({
    aksi: aksiRaw,
    price, tp, sl, closes,
    pwr, bdr: bdr.label,
    hist, histPrev, goldenCross, deathCross,
    liquidityStatus,
    regime: regimeInfo.regime
  });

  // ── Recompute TP/SL kalau AKSI final berubah (SELL ↔ BUY) ──────────
  // Biasanya downgrade ke HOLD, tidak perlu recompute. Tapi safety check.
  let finalTP = tp, finalSL = sl;
  if(filtered.aksi !== aksiRaw && filtered.aksi !== 'HOLD'){
    const recomputed = calculateTPSL(price, atr, fase, filtered.aksi, highs, lows);
    finalTP = recomputed.tp;
    finalSL = recomputed.sl;
  }

  const rsiSig       = getRSISignal(rsi);
  const macdSigLabel = getMACDSignal(macd, macdSig, goldenCross, deathCross);
  const rvolSig      = getRVOLSignal(rvol);
  const zoneLabel    = getZoneLabel(zone);

  return {
    ticker,
    ok: true,
    price: Math.round(price),
    chg,
    rsi, rsiLabel: rsiSig.label,
    macd, macdSig, hist, macdLabel: macdSigLabel.label,
    goldenCross, deathCross,
    zone, zoneLabel,
    rvol, rvolLabel: rvolSig.label,
    bdr: bdr.label,
    pwr,
    fase,
    aksi: filtered.aksi,
    aksiOriginal: filtered.aksiOriginal,
    downgraded: filtered.downgraded,
    warnings: filtered.warnings,
    blocksFrom: filtered.blocksFrom,
    rr: filtered.rr,
    tp: finalTP,
    sl: finalSL,
    e1, e2, e3,
    // ── Patch v2 metadata ──
    liquidity: liquidityStatus.label,
    avgValueIDR: Math.round(liquidity.avgValue),
    aboveSMA50:  filtered.aboveSMA50,
    aboveSMA200: filtered.aboveSMA200,
    sma50:  filtered.sma50  ? Math.round(filtered.sma50)  : null,
    sma200: filtered.sma200 ? Math.round(filtered.sma200) : null,
    crossValid: filtered.crossValid
  };
}

// ── Format helper ──────────────────────────────────────────────────────
function fmtIDR(n){
  if(n >= 1e12) return (n/1e12).toFixed(2)+'T';
  if(n >= 1e9)  return (n/1e9).toFixed(2)+'M';
  if(n >= 1e6)  return (n/1e6).toFixed(2)+'Jt';
  return n.toString();
}

async function runScreener(){
  const now = new Date().toLocaleString('id-ID', { timeZone:'Asia/Jakarta' });
  console.log('\n' + '='.repeat(78));
  console.log('SCREENER SAHAM IDX v2 - ' + now);
  console.log('='.repeat(78));

  // ── FIX #4: Fetch IHSG dulu untuk regime filter ────────────────────
  process.stdout.write('Fetching IHSG untuk market regime...\r');
  const regimeInfo = await fetchIHSG();
  const regimeEmoji = { BULL:'🟢', NEUTRAL:'🟡', BEAR:'🔴', UNKNOWN:'⚪' }[regimeInfo.regime] || '⚪';
  console.log(`${regimeEmoji} MARKET REGIME (IHSG): ${regimeInfo.regime}`
    + (regimeInfo.price  ? ` | Price: ${Math.round(regimeInfo.price)}` : '')
    + (regimeInfo.sma50  ? ` | SMA50: ${Math.round(regimeInfo.sma50)}` : '')
    + (regimeInfo.sma200 ? ` | SMA200: ${Math.round(regimeInfo.sma200)}` : '')
    + ` | RSI: ${regimeInfo.rsi}`);
  console.log('-'.repeat(78));

  const results = {};
  for(const ticker of WATCHLIST){
    process.stdout.write(`Scanning ${ticker}...                     \r`);
    results[ticker] = await screenStock(ticker, regimeInfo);
    await sleep(500);
  }

  const sukses = Object.values(results).filter(r => r.ok).length;
  console.log(`\nScan selesai - ${sukses}/${WATCHLIST.length} saham berhasil\n`);

  // ═══ 🟢 SINYAL BELI TERKONFIRMASI ═══════════════════════════════════
  console.log('─'.repeat(78));
  console.log('🟢 SINYAL BELI TERKONFIRMASI (lolos semua filter v2):');
  console.log('─'.repeat(78));
  const beliBull = Object.values(results).filter(r =>
    r.ok && (r.aksi === 'HAKA' || r.aksi === 'BUY')
  );

  if(!beliBull.length){
    console.log('  Tidak ada sinyal beli terkonfirmasi.');
  }else{
    // Sort by PWR desc, lalu R:R desc
    beliBull.sort((a,b) => (b.pwr - a.pwr) || (b.rr - a.rr));
    beliBull.forEach(r => {
      const cross = r.goldenCross ? '🟡 GOLDEN CROSS' : r.zoneLabel;
      const trendTag = r.aboveSMA200 === true ? '↗SMA200' : r.aboveSMA200 === false ? '↘SMA200' : '?SMA200';
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.aksi.padEnd(4)} | ${r.fase.padEnd(9)} | ${cross.padEnd(18)} | ` +
        `PWR:${r.pwr} | R:R ${r.rr} | ${trendTag} | ${r.liquidity.padEnd(7)} | ` +
        `Harga:${r.price} | TP:${r.tp} | SL:${r.sl}`
      );
      if(r.warnings.length){
        r.warnings.forEach(w => console.log(`         ⚠  ${w}`));
      }
    });
  }

  // ═══ 🔴 SINYAL JUAL TERKONFIRMASI ═══════════════════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('🔴 SINYAL JUAL TERKONFIRMASI:');
  console.log('─'.repeat(78));
  const jualBear = Object.values(results).filter(r =>
    r.ok && r.aksi === 'SELL' &&
    (r.deathCross || r.zone === 'BEAR_ZONE' || r.zone === 'ZERO_CROSS_DOWN')
  );

  if(!jualBear.length){
    console.log('  Tidak ada sinyal jual terkonfirmasi.');
  }else{
    jualBear.forEach(r => {
      const cross = r.deathCross ? '💀 DEATH CROSS' : r.zoneLabel;
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.aksi.padEnd(4)} | ${r.fase.padEnd(9)} | ${cross.padEnd(18)} | ` +
        `PWR:${r.pwr} | R:R ${r.rr} | RVOL:${r.rvol} | ` +
        `Harga:${r.price} | TP:${r.tp} | SL:${r.sl}`
      );
      if(r.warnings.length){
        r.warnings.forEach(w => console.log(`         ⚠  ${w}`));
      }
    });
  }

  // ═══ ⚠️ DOWNGRADE BY FILTER v2 (audit trail) ════════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('⚠️  DOWNGRADE BY FILTER v2 (AKSI asli diturunkan karena gagal filter):');
  console.log('─'.repeat(78));
  const downgraded = Object.values(results).filter(r => r.ok && r.downgraded);

  if(!downgraded.length){
    console.log('  Tidak ada downgrade.');
  }else{
    downgraded.forEach(r => {
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.aksiOriginal} → ${r.aksi.padEnd(4)} | ` +
        `PWR:${r.pwr} | ${r.liquidity.padEnd(7)} | Harga:${r.price}`
      );
      r.blocksFrom.forEach(b => console.log(`         └─ ${b}`));
    });
  }

  // ═══ ⚠️ SINYAL AMBIGU (zone vs aksi berlawanan) ═════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('⚠️  SINYAL AMBIGU (arah sinyal vs zone berlawanan):');
  console.log('─'.repeat(78));
  const ambigu = Object.values(results).filter(r => {
    if(!r.ok) return false;
    const beliTapiBearZone = (r.aksi === 'BUY' || r.aksi === 'HAKA') && (r.zone === 'BEAR_ZONE' || r.zone === 'ZERO_CROSS_DOWN');
    const jualTapiBullZone = r.aksi === 'SELL' && (r.zone === 'BULL_ZONE' || r.zone === 'ZERO_CROSS_UP');
    return beliTapiBearZone || jualTapiBullZone;
  });

  if(!ambigu.length){
    console.log('  Tidak ada sinyal ambigu.');
  }else{
    ambigu.forEach(r => {
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.aksi.padEnd(4)} | ${r.fase.padEnd(9)} | ${r.zoneLabel.padEnd(18)} | ` +
        `PWR:${r.pwr} | RVOL:${r.rvol} | Harga:${r.price}`
      );
    });
  }

  // ═══ 📊 LIKUIDITAS RENDAH (watchlist audit) ═══════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('📊 SAHAM DENGAN LIKUIDITAS RENDAH (avg value < Rp 5M/hari):');
  console.log('─'.repeat(78));
  const illiquid = Object.values(results).filter(r =>
    r.ok && (r.liquidity === 'TIPIS' || r.liquidity === 'ILIKUID')
  );

  if(!illiquid.length){
    console.log('  Semua saham di watchlist cukup likuid.');
  }else{
    illiquid.forEach(r => {
      console.log(`  ${r.ticker.padEnd(6)} | ${r.liquidity.padEnd(7)} | avg value: Rp ${fmtIDR(r.avgValueIDR)}`);
    });
    console.log('  💡 Pertimbangkan drop dari watchlist atau kurangi position size.');
  }

  console.log('\n' + '='.repeat(78));
  return { results, regimeInfo };
}

module.exports = { runScreener, screenStock, fetchIHSG, WATCHLIST };
