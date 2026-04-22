const TI = require('technicalindicators');

// ── Helper: guard NaN / Infinity ──────────────────────────────────────────
function safeNum(x, def=0){
  return Number.isFinite(x) ? x : def;
}

// ── Helper: rata-rata array ───────────────────────────────────────────────
function avg(arr){
  if(!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((a,b) => a+b, 0) / arr.length;
}

// ── RSI ───────────────────────────────────────────────────────────────────
function calculateRSI(closes, period=14){
  try{
    const rsi = TI.RSI.calculate({ values: closes, period });
    return rsi.length ? safeNum(parseFloat(rsi.at(-1).toFixed(2)), 50) : 50;
  }catch{ return 50; }
}

function getRSISignal(rsi){
  if(rsi < 30) return { label:'OVERSOLD',    score: 3 };
  if(rsi < 45) return { label:'MULAI PULIH', score: 2 };
  if(rsi < 55) return { label:'NETRAL',      score: 0 };
  if(rsi < 70) return { label:'BULLISH',     score: 1 };
  return               { label:'OVERBOUGHT', score:-1 };
}

// ── MACD ──────────────────────────────────────────────────────────────────
function calculateMACD(closes){
  try{
    const result = TI.MACD.calculate({
      values: closes,
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false
    });

    if(!result.length) return {
      macd:0, signal:0, hist:0, histPrev:0, macdPrev:0, signalPrev:0,
      goldenCross:false, deathCross:false, zone:'BEAR_ZONE'
    };

    const last = result.at(-1);
    const prev = result.length >= 2 ? result.at(-2) : last;

    const macdNow  = safeNum(parseFloat((last.MACD      ?? 0).toFixed(2)));
    const sigNow   = safeNum(parseFloat((last.signal    ?? 0).toFixed(2)));
    const histNow  = safeNum(parseFloat((last.histogram ?? 0).toFixed(2)));
    const macdPrev = safeNum(parseFloat((prev.MACD      ?? 0).toFixed(2)));
    const sigPrev  = safeNum(parseFloat((prev.signal    ?? 0).toFixed(2)));
    const histPrev = safeNum(parseFloat((prev.histogram ?? 0).toFixed(2)));  // ← PATCH: needed for cross confirmation

    const goldenCross = macdPrev < sigPrev && macdNow > sigNow;
    const deathCross  = macdPrev > sigPrev && macdNow < sigNow;

    let zone;
    if     (macdPrev < 0 && macdNow >= 0) zone = 'ZERO_CROSS_UP';
    else if(macdPrev > 0 && macdNow <= 0) zone = 'ZERO_CROSS_DOWN';
    else if(macdNow > 0)                  zone = 'BULL_ZONE';
    else                                   zone = 'BEAR_ZONE';

    return { macd:macdNow, signal:sigNow, hist:histNow, histPrev, macdPrev, signalPrev:sigPrev, goldenCross, deathCross, zone };

  }catch{
    return {
      macd:0, signal:0, hist:0, histPrev:0, macdPrev:0, signalPrev:0,
      goldenCross:false, deathCross:false, zone:'BEAR_ZONE'
    };
  }
}

function getMACDSignal(macd, signal, goldenCross, deathCross){
  if(goldenCross)   return { label:'GOLDEN CROSS', score: 3 };
  if(deathCross)    return { label:'DEATH CROSS',  score:-3 };
  if(macd > signal) return { label:'BULLISH',      score: 2 };
  if(macd < signal) return { label:'BEARISH',      score:-1 };
  return              { label:'NETRAL',            score: 0 };
}

function getZoneLabel(zone){
  switch(zone){
    case 'ZERO_CROSS_UP':   return 'ZERO CROSS UP';
    case 'ZERO_CROSS_DOWN': return 'ZERO CROSS DOWN';
    case 'BULL_ZONE':       return 'BULL ZONE';
    default:                return 'BEAR ZONE';
  }
}

// ── RVOL ──────────────────────────────────────────────────────────────────
function calculateRVOL(volumes){
  if(volumes.length < 21) return 1;
  const avg20 = avg(volumes.slice(-21, -1));
  if(avg20 === 0) return 1;
  return safeNum(parseFloat((volumes.at(-1) / avg20).toFixed(2)), 1);
}

function getRVOLSignal(rvol){
  if(rvol < 0.6) return { label:'SEPI',         score:-1 };
  if(rvol < 1.0) return { label:'NORMAL',        score: 0 };
  if(rvol < 1.5) return { label:'RAMAI',         score: 1 };
  if(rvol < 2.0) return { label:'AKTIF',         score: 2 };
  return           { label:'BANDAR MASUK',  score: 3 };
}

// ── ATR ───────────────────────────────────────────────────────────────────
function calculateATR(highs, lows, closes, period=14){
  const trs = [];
  for(let i=1; i<highs.length; i++){
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i]  - closes[i-1])
    ));
  }
  return safeNum(avg(trs.slice(-period)));
}

// ── CHG% ──────────────────────────────────────────────────────────────────
function calculateCHG(price, prevClose){
  if(!prevClose) return 0;
  return safeNum(parseFloat(((price - prevClose) / prevClose * 100).toFixed(2)));
}

// ── WICK ──────────────────────────────────────────────────────────────────
function calculateWick(highs, lows, closes){
  const h  = highs.at(-1)  || 0;
  const l  = lows.at(-1)   || 0;
  const c  = closes.at(-1) || 1;
  const pv = closes.at(-2) || c;
  return safeNum((Math.min(c, pv) - l) / (h - l || 1) * 100);
}

// ── BDR ───────────────────────────────────────────────────────────────────
function calculateBDR(volumes, closes, rvol, rsi, wick){
  const n    = 20;
  if(closes.length < n || volumes.length < n) return { label:'', score:0 };  // ← PATCH: guard bound

  const rv   = volumes.slice(-n);
  const avgV = avg(rv);

  let bigUp = 0, bigDown = 0;

  for(let i=1; i<rv.length; i++){
    const volBesar = rv[i] > avgV * 1.5;
    const naik     = closes[closes.length - n + i] >  closes[closes.length - n + i - 1];
    const turun    = closes[closes.length - n + i] <= closes[closes.length - n + i - 1];
    if(volBesar && naik)  bigUp++;
    if(volBesar && turun) bigDown++;
  }

  const c1 = closes.at(-1);
  const c2 = closes.at(-2);
  const c3 = closes.at(-3);

  // Akumulasi terang-terangan
  if(rvol > 2   && bigUp >= 4 && c1 >= c2 && c2 >= c3) return { label:'BIG ACC', score: 3 };
  if(rvol > 1.4 && bigUp >= 2)                          return { label:'AKUM',    score: 2 };

  // Akumulasi terselubung: harga turun tapi RSI rendah + wick panjang
  if(rvol > 1.5 && bigDown >= 2 && c1 < c2 && rsi < 40){
    if(wick > 25) return { label:'AKUM',  score: 2 };
    return          { label:'AKUM?', score: 1 };
  }
  if(rvol > 1.5 && bigDown >= 2 && c1 < c2 && rsi < 45 && wick > 30) return { label:'AKUM?', score: 1 };

  // Distribusi: volume besar + harga turun + RSI masih tinggi
  if(rvol > 1.5 && bigDown >= 3 && c1 < c2 && rsi > 55) return { label:'DIST', score:-2 };
  if(rvol > 1.2 && bigDown >= 2 && c1 < c2 && c2 < c3 && rsi > 50) return { label:'DIST', score:-2 };

  return { label:'', score:0 };
}

// ── PWR ───────────────────────────────────────────────────────────────────
function calculatePWR(rsi, macd, macdSig, rvol, chg, hist, goldenCross, deathCross){
  let s = 0;

  if(rsi < 30)        s += 2;
  else if(rsi < 45)   s += 1;
  else if(rsi > 75)   s -= 2;
  else if(rsi > 65)   s -= 1;

  if(macd > macdSig)  s += 1;
  if(hist > 0)        s += 1;

  if(rvol > 2.5)      s += 2;
  else if(rvol > 1.5) s += 1;
  else if(rvol < 0.6) s -= 1;

  if(chg > 3)         s += 1;
  else if(chg < -4)   s -= 2;
  else if(chg < -2)   s -= 1;

  if(goldenCross)     s += 2;
  if(deathCross)      s -= 2;

  return Math.min(5, Math.max(1, s));
}

// ── FASE ──────────────────────────────────────────────────────────────────
function calculateFASE(rsi, macd, macdSig, chg, wick, hist){
  const bull   = macd > macdSig;
  const rising = hist > 0;

  if(chg > 3   && bull && rsi > 50 && rsi < 78) return 'BREAKOUT';
  if(wick > 20 && rsi < 52 && bull)              return 'REBOUND';
  if(rsi < 36  && bull && rising)                return 'REBOUND';
  if(chg < -4  && !bull)                         return 'BREAKDOWN';
  if(!bull     && rsi > 65)                      return 'BREAKDOWN';
  return 'SIDEWAYS';
}

// ── AKSI ──────────────────────────────────────────────────────────────────
function calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase, goldenCross, deathCross, bdr, zone){
  const bull     = macd > macdSig;
  const bullZone = zone === 'BULL_ZONE' || zone === 'ZERO_CROSS_UP';
  const bearZone = zone === 'BEAR_ZONE' || zone === 'ZERO_CROSS_DOWN';

  // ── Death Cross + Bull Zone → bisa false signal, konfirmasi via FASE & RSI ──
  if(deathCross && bullZone){
    if(fase === 'BREAKDOWN') return 'SELL';
    if(fase === 'SIDEWAYS'){
      if(rsi < 40) return 'HOLD';
      if(rsi < 50) return 'SELL';
      return 'HOLD';
    }
    return 'HOLD';
  }

  // ── SELL prioritas ────────────────────────────────────────────────────
  if(deathCross)                        return 'SELL';
  if(bdr === 'DIST' && !bull)           return 'SELL';
  if(rsi > 70 && !bull)                 return 'SELL';
  if(fase === 'BREAKDOWN')              return 'SELL';
  if(pwr <= 2 && !bull && rsi > 60)     return 'SELL';

  // ── Proteksi jebakan bull ─────────────────────────────────────────────
  if(bdr === 'DIST' && bullZone)                 return 'HOLD';
  if(goldenCross && bearZone && bdr === 'DIST')   return 'SELL';

  // ── BUY / HAKA ────────────────────────────────────────────────────────
  if(goldenCross && bull && rvol > 1.0)
    return bearZone ? 'BUY' : 'HAKA';

  if(bdr === 'BIG ACC' && bull && rvol > 1.3)
    return bullZone ? 'HAKA' : 'BUY';

  if(bdr === 'AKUM' && bull && rsi < 45 && fase !== 'BREAKDOWN')
    return 'BUY';

  if(pwr >= 4 && bull && (fase === 'BREAKOUT' || fase === 'REBOUND') && rvol > 1.3)
    return bullZone ? 'HAKA' : 'BUY';

  if(pwr >= 3 && bull && fase !== 'BREAKDOWN'){
    if(bearZone && pwr >= 4 && rsi < 45 && fase === 'REBOUND') return 'BUY';
    if(bearZone && pwr >= 5 && rsi < 50)                       return 'BUY';
    return bearZone ? 'HOLD' : 'BUY';
  }

  return 'HOLD';
}

// ── FRAKSI HARGA ──────────────────────────────────────────────────────────
function getFraksi(price){
  if(price <  200) return 1;
  if(price <  500) return 2;
  if(price < 2000) return 5;
  if(price < 5000) return 10;
  return 25;
}

function roundToFraksi(price, fraksi){
  return Math.round(price / fraksi) * fraksi;
}

// ── TP & SL ───────────────────────────────────────────────────────────────
function calculateTPSL(price, atr, fase, aksi, highs, lows){
  if(!isFinite(price) || !isFinite(atr)) return { tp:null, sl:null };

  const resist  = Math.max(...highs.slice(-10));
  const support = Math.min(...lows.slice(-10));
  const fraksi  = getFraksi(price);
  let tp, sl;

  if(aksi === 'SELL'){
    tp = roundToFraksi(price - atr * 1.5, fraksi);
    sl = roundToFraksi(price + atr * 1.0, fraksi);
  }else{
    const mult = fase === 'BREAKOUT' ? 2.5 : 2.0;
    tp = roundToFraksi(Math.min(price + atr * mult, resist * 1.02), fraksi);
    sl = roundToFraksi(Math.max(price - atr * 1.0, support * 0.99), fraksi);
    if(tp <= price) tp = roundToFraksi(price + atr * 1.5, fraksi);
    if(sl >= price) sl = roundToFraksi(price - atr * 0.8, fraksi);
  }

  return { tp, sl };
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────
function calculateEntry(price, atr, fase, aksi, highs, lows){
  if(aksi === 'SELL') return { e1:null, e2:null, e3:null };

  const fraksi  = getFraksi(price);
  const support = Math.min(...lows.slice(-10));
  let e1, e2, e3;

  if(fase === 'BREAKOUT'){
    e1 = roundToFraksi(price, fraksi);
    e2 = roundToFraksi(price - atr * 0.3, fraksi);
    e3 = roundToFraksi(price - atr * 0.6, fraksi);
  }else if(fase === 'REBOUND'){
    e1 = roundToFraksi(price, fraksi);
    e2 = roundToFraksi(price - atr * 0.5, fraksi);
    e3 = roundToFraksi(Math.max(support * 1.01, price - atr * 1.0), fraksi);
  }else{
    e1 = roundToFraksi(price, fraksi);
    e2 = roundToFraksi(price - atr * 0.4, fraksi);
    e3 = roundToFraksi(price - atr * 0.8, fraksi);
  }

  const sl = roundToFraksi(Math.max(price - atr * 1.0, support * 0.99), fraksi);
  if(e3 <= sl) e3 = roundToFraksi(sl + fraksi * 2, fraksi);
  if(e2 <= sl) e2 = roundToFraksi(sl + fraksi * 4, fraksi);

  return { e1, e2, e3 };
}

// ═════════════════════════════════════════════════════════════════════════
// ║ PATCH v2 — FIX #1–5                                                   ║
// ║   #1 Filter likuiditas absolut                                        ║
// ║   #2 Trend filter SMA50 / SMA200                                      ║
// ║   #3 Konfirmasi MACD cross (anti-whipsaw)                             ║
// ║   #4 Market regime IHSG                                               ║
// ║   #5 Validasi R:R minimum 1:2                                         ║
// ═════════════════════════════════════════════════════════════════════════

// ── SMA ──────────────────────────────────────────────────────────────────
function calculateSMA(values, period){
  if(!Array.isArray(values) || values.length < period) return null;
  const result = avg(values.slice(-period));
  return Number.isFinite(result) ? result : null;
}

// ── FIX #1: LIKUIDITAS ABSOLUT ───────────────────────────────────────────
// Hitung rata-rata nilai transaksi harian (IDR) — volume × harga
function calculateLiquidity(closes, volumes, lookback=20){
  const n = Math.min(closes.length, volumes.length, lookback);
  if(n < 10) return { avgValue:0, avgVolume:0 };

  const c = closes.slice(-n);
  const v = volumes.slice(-n);
  const values = v.map((vol, i) => vol * c[i]);

  return {
    avgValue: safeNum(avg(values)),
    avgVolume: safeNum(avg(v))
  };
}

// Status likuiditas: threshold default Rp 5 miliar/hari (David's spec)
function getLiquidityStatus(liquidity, minValueIDR=5_000_000_000){
  const v = liquidity.avgValue;
  if(v >= minValueIDR * 2)   return { label:'LIKUID+', ok:true,  score: 2 };
  if(v >= minValueIDR)       return { label:'LIKUID',  ok:true,  score: 1 };
  if(v >= minValueIDR / 2)   return { label:'TIPIS',   ok:false, score:-1 };
  return                       { label:'ILIKUID', ok:false, score:-2 };
}

// ── FIX #3: KONFIRMASI MACD CROSS ────────────────────────────────────────
// Tolak cross yang "noise" di sekitar zero line.
// Valid kalau: (a) histogram magnitude > threshold, dan
//              (b) histogram masih accelerating di arah cross.
function confirmCross(price, hist, histPrev, goldenCross, deathCross){
  if(!goldenCross && !deathCross) return { confirmed:true, reason:'no-cross' };

  // Threshold relatif ke harga — 0.05% dari harga, minimum 0.1
  const histThreshold = Math.max(0.1, price * 0.0005);

  if(goldenCross){
    if(hist < histThreshold)     return { confirmed:false, reason:`hist ${hist} < threshold` };
    if(hist <= histPrev)         return { confirmed:false, reason:'hist tidak akselerasi' };
    return { confirmed:true, reason:'valid' };
  }

  if(deathCross){
    if(Math.abs(hist) < histThreshold) return { confirmed:false, reason:`hist ${hist} < threshold` };
    if(hist >= histPrev)                return { confirmed:false, reason:'hist tidak akselerasi' };
    return { confirmed:true, reason:'valid' };
  }

  return { confirmed:true, reason:'none' };
}

// ── FIX #4: MARKET REGIME (IHSG) ─────────────────────────────────────────
// Input: array closes IHSG. Output: { regime, rsi, price, sma50, sma200 }
function calculateRegime(ihsgCloses){
  if(!Array.isArray(ihsgCloses) || ihsgCloses.length < 50){
    return { regime:'UNKNOWN', rsi:50, price:null, sma50:null, sma200:null };
  }

  const rsi    = calculateRSI(ihsgCloses);
  const sma50  = calculateSMA(ihsgCloses, 50);
  const sma200 = ihsgCloses.length >= 200 ? calculateSMA(ihsgCloses, 200) : null;
  const price  = ihsgCloses.at(-1);

  const aboveSMA50  = sma50  && price > sma50;
  const aboveSMA200 = sma200 && price > sma200;

  let regime;
  if(aboveSMA50 && rsi > 55 && (aboveSMA200 || sma200 === null))  regime = 'BULL';
  else if(!aboveSMA50 && rsi < 40)                                  regime = 'BEAR';
  else if(!aboveSMA50 && sma200 && !aboveSMA200)                    regime = 'BEAR';
  else                                                               regime = 'NEUTRAL';

  return { regime, rsi, price, sma50, sma200 };
}

// ── FIX #5: RISK:REWARD RATIO ────────────────────────────────────────────
function calculateRR(price, tp, sl, aksi){
  if(!isFinite(price) || !isFinite(tp) || !isFinite(sl)) return 0;
  if(aksi === 'SELL'){
    const reward = price - tp;
    const risk   = sl - price;
    if(risk <= 0 || reward <= 0) return 0;
    return safeNum(parseFloat((reward / risk).toFixed(2)));
  }
  // BUY/HAKA
  const reward = tp - price;
  const risk   = price - sl;
  if(risk <= 0 || reward <= 0) return 0;
  return safeNum(parseFloat((reward / risk).toFixed(2)));
}

// ── POST-PROCESSOR: APPLY FIX #1–5 KE AKSI ──────────────────────────────
// Input: semua context yang dibutuhkan untuk decision downgrade/block.
// Output: { aksi (final), aksiOriginal, warnings, rr, sma50, sma200, ... }
function applyFilters(ctx){
  const {
    aksi, price, tp, sl, closes,
    pwr, bdr, hist, histPrev, goldenCross, deathCross,
    liquidityStatus, regime,
    rvol = 1, fase = ''      // ← patch v2.1: untuk BEAR exception
  } = ctx;

  const warnings   = [];
  const blocksFrom = [];  // audit trail: fix mana yang men-downgrade
  let finalAksi    = aksi;

  // ── FIX #3: Konfirmasi MACD cross ─────────────────────────────────────
  const crossConf = confirmCross(price, hist, histPrev, goldenCross, deathCross);
  let crossValid  = crossConf.confirmed;

  if(!crossConf.confirmed && (goldenCross || deathCross)){
    warnings.push(`Cross tidak valid: ${crossConf.reason}`);
    // Kalau AKSI asli bergantung pada golden cross → downgrade
    if(goldenCross && (finalAksi === 'HAKA' || finalAksi === 'BUY')){
      const prevAksi = finalAksi;
      finalAksi = 'HOLD';
      blocksFrom.push(`#3 cross: ${prevAksi}→HOLD`);
    }
    // Death cross tidak valid → tetap boleh SELL kalau ada alasan lain (fase, dist),
    // tapi tandai warning.
  }

  // ── FIX #1: Likuiditas absolut ────────────────────────────────────────
  if(!liquidityStatus.ok && (finalAksi === 'HAKA' || finalAksi === 'BUY')){
    const prevAksi = finalAksi;
    finalAksi = 'HOLD';
    blocksFrom.push(`#1 likuiditas: ${prevAksi}→HOLD`);
    warnings.push(`Likuiditas ${liquidityStatus.label} — tidak aman entry`);
  }

  // ── FIX #2: Trend filter SMA50 / SMA200 ───────────────────────────────
  const sma50       = calculateSMA(closes, 50);
  const sma200      = calculateSMA(closes, 200);
  const aboveSMA50  = sma50  ? price > sma50  : null;
  const aboveSMA200 = sma200 ? price > sma200 : null;

  if(sma200 !== null && !aboveSMA200){
    // Di bawah SMA200 = downtrend jangka panjang.
    // Di BEAR regime: threshold diturunkan (hampir semua saham <SMA200 saat BEAR).
    // Di BULL/NEUTRAL: tetap ketat — hanya PWR>=5 + BIG ACC.
    const superStrong = regime === 'BEAR'
      ? pwr >= 4 && (bdr === 'BIG ACC' || bdr === 'AKUM')
      : pwr >= 5 && bdr === 'BIG ACC';
    if((finalAksi === 'HAKA' || finalAksi === 'BUY') && !superStrong){
      const prevAksi = finalAksi;
      if(finalAksi === 'HAKA') finalAksi = 'BUY';   // downgrade agresivitas
      else                      finalAksi = 'HOLD'; // BUY → HOLD
      blocksFrom.push(`#2 <SMA200: ${prevAksi}→${finalAksi}`);
      warnings.push('Di bawah SMA200 (downtrend jangka panjang)');
    }
  } else if(sma200 === null){
    warnings.push('Data <200 bar — SMA200 tidak tersedia');
  }

  // ── FIX #4: Market regime IHSG ────────────────────────────────────────
  if(regime === 'BEAR'){
    if(finalAksi === 'HAKA'){
      finalAksi = 'BUY';
      blocksFrom.push('#4 IHSG BEAR: HAKA→BUY');
      warnings.push('IHSG BEAR — agresivitas diturunkan');
    }else if(finalAksi === 'BUY'){
      // Exception: tetap lolos sebagai BUY kalau saham menunjukkan kekuatan
      // signifikan di atas market (outlier bear market).
      // Syarat: PWR >= 4, RVOL >= 2x, FASE BREAKOUT atau REBOUND
      const bearOutlier = pwr >= 4 && rvol >= 2 && (fase === 'BREAKOUT' || fase === 'REBOUND');
      if(bearOutlier){
        warnings.push('⚡ BEAR OUTLIER: lolos filter IHSG BEAR (PWR kuat + RVOL tinggi + ' + fase + ')');
      }else{
        finalAksi = 'HOLD';
        blocksFrom.push('#4 IHSG BEAR: BUY→HOLD');
        warnings.push('IHSG BEAR — BUY ditahan');
      }
    }
  }else if(regime === 'NEUTRAL'){
    if(finalAksi === 'HAKA' && !(pwr >= 5 && bdr === 'BIG ACC')){
      finalAksi = 'BUY';
      blocksFrom.push('#4 IHSG NEUTRAL: HAKA→BUY');
      warnings.push('IHSG NETRAL — HAKA diturunkan ke BUY');
    }
  }

  // ── FIX #5: R:R minimum ───────────────────────────────────────────────
  // BEAR regime: target lebih pendek, threshold diturunkan ke 1.5.
  // BULL/NEUTRAL: tetap 2.0.
  const rrMin = regime === 'BEAR' ? 1.5 : 2.0;
  const rr = calculateRR(price, tp, sl, finalAksi);
  if((finalAksi === 'HAKA' || finalAksi === 'BUY') && rr > 0 && rr < rrMin){
    const prevAksi = finalAksi;
    finalAksi = 'HOLD';
    blocksFrom.push(`#5 R:R ${rr}<${rrMin}: ${prevAksi}→HOLD`);
    warnings.push(`R:R ${rr} < 1:${rrMin} — setup tidak worth risk`);
  }
  if(finalAksi === 'SELL' && rr > 0 && rr < 1.5){
    warnings.push(`R:R SELL ${rr} < 1:1.5 (marginal)`);
  }

  return {
    aksi: finalAksi,
    aksiOriginal: aksi,
    downgraded: finalAksi !== aksi,
    warnings,
    blocksFrom,
    rr,
    sma50,
    sma200,
    aboveSMA50,
    aboveSMA200,
    crossValid
  };
}

// ── EXPORTS ───────────────────────────────────────────────────────────────
module.exports = {
  avg,
  calculateRSI,    getRSISignal,
  calculateMACD,   getMACDSignal,  getZoneLabel,
  calculateRVOL,   getRVOLSignal,
  calculateATR,    calculateCHG,
  calculateWick,   calculateBDR,
  calculatePWR,    calculateFASE,
  calculateAKSI,   calculateTPSL,
  calculateEntry,  getFraksi,
  roundToFraksi,
  // ── Patch v2 exports ──
  calculateSMA,
  calculateLiquidity,  getLiquidityStatus,
  confirmCross,
  calculateRegime,
  calculateRR,
  applyFilters
};
