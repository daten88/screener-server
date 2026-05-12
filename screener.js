const axios = require('axios');
const {
  calculateRSI, getRSISignal,
  calculateMACD, getMACDSignal, getZoneLabel,
  calculateRVOL, getRVOLSignal,
  calculateATR, calculateCHG,
  calculateWick, calculateBDR,
  calculatePWR, calculateFASE,
  calculateAKSI, calculateTPSL, calculateEntry,
  inferPineStatus,       // ✅ NEW v7
  formatScreenerOutput,  // ✅ NEW v7
  calculateLiquidity, getLiquidityStatus,
  calculateRegime, applyFilters
} = require('./indicators');

const WATCHLIST = ['AHAP','ARCI','ASHA','ASLI','ASPR','ATAP','AYAM','BAIK','BBYB','BDMN',
'BGTG','BIPI','BNBR','BRMS','BRPT','BULL','BUMI','BUVA','BWPT','CARE',
'COCO','CPRO','CTTH','CUAN','DATA','DEFI','DEWA','DKFT','DKHH','DOOH',
'DPUM','ELSA','ELTY','EMAS','EMTK','ENRG','ENZO','ESIP','FORE','GTSI',
'HUMI','IBOS','ICON','IMPC','INCF','INCO','INDY','INKP','JGLE','KBLV',
'KETR','KING','KLAS','KPIG','KRYA','MAIN','MBSS','MDIA','MDKA','MEDS',
'MINA','NAYZ','NINE','OASA','PACK','PADA','PADI','PSKT','PYFA','RAJA',
'RLCO','RMKE','SINI','SOCI','SOFA','SSIA','TAPG','TKIM','TOBA','TPIA',
'TRIN','TRUE','UNVR','VKTR','WIFI','WMUU','YELO','ZATA'];

const MIN_LIQUIDITY_IDR = 5_000_000_000;
const FETCH_RANGE       = '1y';

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

async function fetchData(ticker){ return fetchDataRaw(`${ticker}.JK`); }

async function fetchIHSG(){
  const data = await fetchDataRaw('^JKSE');
  if(!data){
    console.log('⚠️  Gagal fetch IHSG — regime filter dinonaktifkan');
    return { regime:'UNKNOWN', rsi:50, price:null, sma50:null, sma200:null };
  }
  return calculateRegime(data.closes);
}

// ── Screen satu saham ──────────────────────────────────────────────────────
async function screenStock(ticker, regimeInfo){
  const data = await fetchData(ticker);
  if(!data) return { ticker, ok:false, error:'Gagal fetch semua URL' };

  const { closes, highs, lows, volumes, price, prevClose } = data;

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

  const liquidity       = calculateLiquidity(closes, volumes);
  const liquidityStatus = getLiquidityStatus(liquidity, MIN_LIQUIDITY_IDR);

  const filtered = applyFilters({
    aksi: aksiRaw,
    price, tp, sl, closes,
    pwr, bdr: bdr.label,
    hist, histPrev, goldenCross, deathCross,
    liquidityStatus,
    regime: regimeInfo.regime,
    rvol, fase, rsi
  });

  // ✅ NEW v7 — formatScreenerOutput
  const screenerOut = formatScreenerOutput({
    ticker, price, tp, sl, e1, e2, e3,
    pwr, bdr: bdr.label, fase, chg, rvol, rsi,
    liquidityStatus,
    regime: regimeInfo.regime,
    aksi: aksiRaw,
    filterResult: filtered
  });

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

    // ✅ v7: aksi internal (HAKA bisa ada, tapi tidak ditampilkan langsung)
    aksi:         aksiRaw,
    _aksiInternal: aksiRaw,

    // ✅ v7: categories dari formatScreenerOutput
    category:       screenerOut.category,       // MISSED_HAKA|LIMIT_SETUP|WATCH|SKIP|SELL
    actionText:     screenerOut.actionText,
    confidence:     screenerOut.confidence,      // HIGH|MEDIUM|LOW|CRITICAL
    recommendation: screenerOut.recommendation,
    pineSent:       screenerOut.pine.sent,
    pineReason:     screenerOut.pine.reason,
    levels:         screenerOut.levels,

    // Filter context
    warnings:   filtered.warnings,
    rr:         filtered.rr,
    severityScore: filtered.severityScore,

    // TP/SL/Entry (backward compat)
    tp, sl, e1, e2, e3,

    // Liquidity & SMA
    liquidity:    liquidityStatus.label,
    avgValueIDR:  Math.round(liquidity.avgValue),
    aboveSMA50:   filtered.aboveSMA50,
    aboveSMA200:  filtered.aboveSMA200,
    sma50:  filtered.sma50  ? Math.round(filtered.sma50)  : null,
    sma200: filtered.sma200 ? Math.round(filtered.sma200) : null,
    crossValid: filtered.crossValid
  };
}

function fmtIDR(n){
  if(n >= 1e12) return (n/1e12).toFixed(2)+'T';
  if(n >= 1e9)  return (n/1e9).toFixed(2)+'M';
  if(n >= 1e6)  return (n/1e6).toFixed(2)+'Jt';
  return n.toString();
}

async function runScreener(){
  const now = new Date().toLocaleString('id-ID', { timeZone:'Asia/Jakarta' });
  console.log('\n' + '='.repeat(78));
  console.log('SCREENER SAHAM IDX v3 - ' + now);
  console.log('='.repeat(78));

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

  // ═══ ⭐ MISSED HAKA ════════════════════════════════════════════════════
  console.log('─'.repeat(78));
  console.log('⭐ MISSED HAKA (Pine sudah kirim alert, harga belum jauh):');
  console.log('─'.repeat(78));
  const missedHaka = Object.values(results).filter(r => r.ok && r.category === 'MISSED_HAKA');
  if(!missedHaka.length){
    console.log('  Tidak ada MISSED_HAKA saat ini.');
  }else{
    missedHaka.sort((a,b) => b.rr - a.rr);
    missedHaka.forEach(r => {
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.confidence.padEnd(8)} | ${r.fase.padEnd(9)} | ` +
        `PWR:${r.pwr} | R:R ${r.rr} | ${r.liquidity.padEnd(7)} | ` +
        `Harga:${r.price} | TP:${r.tp} | SL:${r.sl}`
      );
      console.log(`         💡 ${r.actionText}`);
      if(r.warnings.length) r.warnings.forEach(w => console.log(`         ⚠  ${w}`));
    });
  }

  // ═══ 📌 LIMIT SETUP ═══════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('📌 LIMIT SETUP (Pine skip, tapi E2/E3 menarik untuk antri):');
  console.log('─'.repeat(78));
  const limitSetup = Object.values(results).filter(r => r.ok && r.category === 'LIMIT_SETUP');
  if(!limitSetup.length){
    console.log('  Tidak ada LIMIT_SETUP saat ini.');
  }else{
    limitSetup.sort((a,b) => (b.levels?.e2?.rr || 0) - (a.levels?.e2?.rr || 0));
    limitSetup.forEach(r => {
      const e2rr = r.levels?.e2?.rr || '-';
      const e3rr = r.levels?.e3?.rr || '-';
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.confidence.padEnd(8)} | ${r.fase.padEnd(9)} | ` +
        `PWR:${r.pwr} | E2:${r.e2}(R:R ${e2rr}) | E3:${r.e3}(R:R ${e3rr}) | SL:${r.sl}`
      );
      console.log(`         💡 ${r.actionText}`);
      if(r.pineReason) console.log(`         🔕 Pine: ${r.pineReason}`);
      if(r.warnings.length) r.warnings.forEach(w => console.log(`         ⚠  ${w}`));
    });
  }

  // ═══ 🔴 SELL ══════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('🔴 SINYAL SELL (setup bearish, hindari entry):');
  console.log('─'.repeat(78));
  const sellList = Object.values(results).filter(r => r.ok && r.category === 'SELL');
  if(!sellList.length){
    console.log('  Tidak ada sinyal SELL saat ini.');
  }else{
    sellList.forEach(r => {
      const cross = r.deathCross ? '💀 DEATH CROSS' : r.zoneLabel;
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.fase.padEnd(9)} | ${cross.padEnd(18)} | ` +
        `PWR:${r.pwr} | RVOL:${r.rvol} | Harga:${r.price}`
      );
      if(r.warnings.length) r.warnings.forEach(w => console.log(`         ⚠  ${w}`));
    });
  }

  // ═══ 👀 WATCH (Notable) ═══════════════════════════════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('👀 WATCH — NOTABLE (BUY setup tapi belum HAKA quality):');
  console.log('─'.repeat(78));
  const watchList = Object.values(results).filter(r =>
    r.ok && r.category === 'WATCH' && r._aksiInternal === 'BUY' && r.confidence !== 'CRITICAL'
  );
  if(!watchList.length){
    console.log('  Tidak ada.');
  }else{
    watchList.sort((a,b) => b.rr - a.rr);
    watchList.slice(0,10).forEach(r => {
      console.log(
        `  ${r.ticker.padEnd(6)} | ${r.confidence.padEnd(8)} | ${r.fase.padEnd(9)} | ` +
        `PWR:${r.pwr} | R:R ${r.rr} | Harga:${r.price}`
      );
    });
  }

  // ═══ ❌ SKIP (CRITICAL risk) ══════════════════════════════════════════
  console.log('\n' + '─'.repeat(78));
  console.log('❌ SKIP (likuiditas buruk atau risk terlalu tinggi):');
  console.log('─'.repeat(78));
  const skipList = Object.values(results).filter(r => r.ok && r.category === 'SKIP');
  if(!skipList.length){
    console.log('  Tidak ada saham SKIP.');
  }else{
    skipList.forEach(r => {
      console.log(`  ${r.ticker.padEnd(6)} | ${r.liquidity.padEnd(7)} | avg value: Rp ${fmtIDR(r.avgValueIDR)}`);
    });
  }

  // ═══ 📊 SUMMARY ═══════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(78));
  const cats = Object.values(results).filter(r=>r.ok).reduce((acc,r)=>{
    acc[r.category] = (acc[r.category]||0)+1; return acc;
  },{});
  console.log(`📊 SUMMARY: ${Object.entries(cats).map(([k,v])=>`${k}:${v}`).join(' | ')}`);
  console.log('='.repeat(78));

  return { results, regimeInfo };
}

module.exports = { runScreener, screenStock, fetchIHSG, WATCHLIST };
