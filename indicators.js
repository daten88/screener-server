const TI = require('technicalindicators');

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ===== RSI =====
function calculateRSI(closes, period = 14) {
  try {
    const rsi = TI.RSI.calculate({ values: closes, period });
    return rsi.length ? parseFloat(rsi[rsi.length - 1].toFixed(2)) : 50;
  } catch { return 50; }
}

function getRSISignal(rsi) {
  if (rsi < 30)  return { label: 'OVERSOLD',    score: 3 };
  if (rsi < 45)  return { label: 'MULAI PULIH', score: 2 };
  if (rsi < 55)  return { label: 'NETRAL',      score: 0 };
  if (rsi < 70)  return { label: 'BULLISH',     score: 1 };
  return           { label: 'OVERBOUGHT',  score: -1 };
}

// ===== MACD =====
function calculateMACD(closes) {
  try {
    const result = TI.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    if (!result.length) return {
      macd: 0, signal: 0, hist: 0,
      macdPrev: 0, signalPrev: 0,
      goldenCross: false, deathCross: false,
      zone: 'BEAR_ZONE'
    };

    const last = result[result.length - 1];
    const prev = result.length >= 2 ? result[result.length - 2] : last;

    const macdNow  = parseFloat((last.MACD      ?? 0).toFixed(2));
    const sigNow   = parseFloat((last.signal    ?? 0).toFixed(2));
    const histNow  = parseFloat((last.histogram ?? 0).toFixed(2));
    const macdPrev = parseFloat((prev.MACD      ?? 0).toFixed(2));
    const sigPrev  = parseFloat((prev.signal    ?? 0).toFixed(2));

    const goldenCross = macdPrev < sigPrev && macdNow > sigNow;
    const deathCross  = macdPrev > sigPrev && macdNow < sigNow;

    let zone;
    if      (macdPrev < 0 && macdNow >= 0) zone = 'ZERO_CROSS_UP';
    else if (macdPrev > 0 && macdNow <= 0) zone = 'ZERO_CROSS_DOWN';
    else if (macdNow > 0)                  zone = 'BULL_ZONE';
    else                                   zone = 'BEAR_ZONE';

    return {
      macd:        macdNow,
      signal:      sigNow,
      hist:        histNow,
      macdPrev,
      signalPrev:  sigPrev,
      goldenCross,
      deathCross,
      zone
    };
  } catch {
    return {
      macd: 0, signal: 0, hist: 0,
      macdPrev: 0, signalPrev: 0,
      goldenCross: false, deathCross: false,
      zone: 'BEAR_ZONE'
    };
  }
}

function getMACDSignal(macd, signal, goldenCross, deathCross) {
  if (goldenCross)   return { label: 'GOLDEN CROSS', score: 3 };
  if (deathCross)    return { label: 'DEATH CROSS',  score: -3 };
  if (macd > signal) return { label: 'BULLISH',      score: 2 };
  if (macd < signal) return { label: 'BEARISH',      score: -1 };
  return               { label: 'NETRAL',            score: 0 };
}

function getZoneLabel(zone) {
  switch (zone) {
    case 'ZERO_CROSS_UP':   return 'ZERO CROSS UP';
    case 'ZERO_CROSS_DOWN': return 'ZERO CROSS DOWN';
    case 'BULL_ZONE':       return 'BULL ZONE';
    default:                return 'BEAR ZONE';
  }
}

// ===== RVOL =====
function calculateRVOL(volumes) {
  if (volumes.length < 21) return 1;
  const avg20 = avg(volumes.slice(-21, -1));
  if (avg20 === 0) return 1;
  return parseFloat((volumes[volumes.length - 1] / avg20).toFixed(2));
}

function getRVOLSignal(rvol) {
  if (rvol < 0.6)  return { label: 'SEPI',        score: -1 };
  if (rvol < 1.0)  return { label: 'NORMAL',       score: 0 };
  if (rvol < 1.5)  return { label: 'RAMAI',        score: 1 };
  if (rvol < 2.0)  return { label: 'AKTIF',        score: 2 };
  return             { label: 'BANDAR MASUK', score: 3 };
}

// ===== ATR =====
function calculateATR(highs, lows, closes, period = 14) {
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1])
    ));
  }
  return avg(trs.slice(-period));
}

// ===== CHG% =====
function calculateCHG(price, prevClose) {
  if (!prevClose) return 0;
  return parseFloat(((price - prevClose) / prevClose * 100).toFixed(2));
}

// ===== WICK =====
function calculateWick(highs, lows, closes) {
  const h  = highs[highs.length - 1]   || 0;
  const l  = lows[lows.length - 1]     || 0;
  const c  = closes[closes.length - 1] || 1;
  const pv = closes[closes.length - 2] || c;
  return (Math.min(c, pv) - l) / (h - l || 1) * 100;
}

// ===== BDR =====
function calculateBDR(volumes, closes, rvol, rsi, wick) {
  const n    = 20;
  const rv   = volumes.slice(-n);
  const avgV = avg(rv);

  let bigUp   = 0;
  let bigDown = 0;

  for (let i = 1; i < rv.length; i++) {
    const volBesar   = rv[i] > avgV * 1.5;
    const hargaNaik  = closes[closes.length - n + i] >  closes[closes.length - n + i - 1];
    const hargaTurun = closes[closes.length - n + i] <= closes[closes.length - n + i - 1];
    if (volBesar && hargaNaik)  bigUp++;
    if (volBesar && hargaTurun) bigDown++;
  }

  const c1 = closes[closes.length - 1];
  const c2 = closes[closes.length - 2];
  const c3 = closes[closes.length - 3];

  // BIG ACC
  if (rvol > 2   && bigUp >= 4 && c1 >= c2 && c2 >= c3) return { label: 'BIG ACC', score: 3 };

  // AKUM normal
  if (rvol > 1.4 && bigUp >= 2)                          return { label: 'AKUM',    score: 2 };

  // AKUM TERSELUBUNG - bandar tekan harga untuk kumpul
  if (rvol > 1.5 && bigDown >= 2 && c1 < c2 && rsi < 40) {
    if (wick > 25) return { label: 'AKUM',  score: 2 };
    return           { label: 'AKUM?', score: 1 };
  }

  // AKUM? - potensi akumulasi tapi belum pasti
  if (rvol > 1.5 && bigDown >= 2 && c1 < c2 && rsi < 45 && wick > 30) {
    return { label: 'AKUM?', score: 1 };
  }

  // DIST agresif
  if (rvol > 1.5 && bigDown >= 3 && c1 < c2 && rsi > 55) return { label: 'DIST', score: -2 };

  // DIST halus
  if (rvol > 1.2 && bigDown >= 2 && c1 < c2 && c2 < c3 && rsi > 50) return { label: 'DIST', score: -2 };

  return { label: '', score: 0 };
}

// ===== PWR =====
function calculatePWR(rsi, macd, macdSig, rvol, chg, hist, goldenCross, deathCross) {
  let s = 0;

  if (rsi < 30)        s += 2;
  else if (rsi < 45)   s += 1;
  else if (rsi > 75)   s -= 2;
  else if (rsi > 65)   s -= 1;

  if (macd > macdSig)  s += 1;
  if (hist > 0)        s += 1;

  if (rvol > 2.5)      s += 2;
  else if (rvol > 1.5) s += 1;
  else if (rvol < 0.6) s -= 1;

  if (chg > 3)         s += 1;
  else if (chg < -4)   s -= 2;
  else if (chg < -2)   s -= 1;

  if (goldenCross)     s += 2;
  if (deathCross)      s -= 2;

  return Math.min(5, Math.max(1, s));
}

// ===== FASE =====
function calculateFASE(rsi, macd, macdSig, chg, wick, hist) {
  const bull   = macd > macdSig;
  const rising = hist > 0;
  if (chg > 3   && bull && rsi > 50 && rsi < 78) return 'BREAKOUT';
  if (wick > 20 && rsi < 52 && bull)              return 'REBOUND';
  if (rsi < 36  && bull && rising)                return 'REBOUND';
  if (chg < -4  && !bull)                         return 'BREAKDOWN';
  if (!bull     && rsi > 65)                      return 'BREAKDOWN';
  return 'SIDEWAYS';
}

// ===== AKSI =====
function calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase, goldenCross, deathCross, bdr, zone) {
  const bull     = macd > macdSig;
  const bullZone = zone === 'BULL_ZONE' || zone === 'ZERO_CROSS_UP';
  const bearZone = zone === 'BEAR_ZONE' || zone === 'ZERO_CROSS_DOWN';

  // SELL prioritas tertinggi
  if (deathCross)                        return 'SELL';
  if (bdr === 'DIST' && !bull)           return 'SELL';
  if (rsi > 70 && !bull)                 return 'SELL';
  if (fase === 'BREAKDOWN')              return 'SELL';
  if (pwr <= 2 && !bull && rsi > 60)     return 'SELL';

  // Proteksi DIST di bull zone = jebakan bull
  if (bdr === 'DIST' && bullZone)        return 'HOLD';

  // Golden Cross di bear zone + DIST = semua negatif
  if (goldenCross && bearZone && bdr === 'DIST') return 'SELL';

  // Golden Cross + bull + volume
  if (goldenCross && bull && rvol > 1.0) {
    return bearZone ? 'BUY' : 'HAKA';
  }

  // AKUM terselubung terkonfirmasi
  if (bdr === 'AKUM' && bull
