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
  if (rsi < 30)  return { label: 'OVERSOLD', score: 3 };
  if (rsi < 45)  return { label: 'MULAI PULIH', score: 2 };
  if (rsi < 55)  return { label: 'NETRAL', score: 0 };
  if (rsi < 70)  return { label: 'BULLISH', score: 1 };
  return           { label: 'OVERBOUGHT', score: -1 };
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
    if (!result.length) return { macd: 0, signal: 0, hist: 0 };
    const last = result[result.length - 1];
    return {
      macd:   parseFloat((last.MACD   ?? 0).toFixed(2)),
      signal: parseFloat((last.signal ?? 0).toFixed(2)),
      hist:   parseFloat((last.histogram ?? 0).toFixed(2))
    };
  } catch { return { macd: 0, signal: 0, hist: 0 }; }
}

function getMACDSignal(macd, signal) {
  if (macd > signal) return { label: 'BULLISH', score: 2 };
  if (macd < signal) return { label: 'BEARISH', score: -1 };
  return               { label: 'NETRAL', score: 0 };
}

// ===== RVOL =====
function calculateRVOL(volumes) {
  if (volumes.length < 21) return 1;
  const avg20 = avg(volumes.slice(-21, -1));
  if (avg20 === 0) return 1;
  return parseFloat((volumes[volumes.length - 1] / avg20).toFixed(2));
}

function getRVOLSignal(rvol) {
  if (rvol < 0.6)  return { label: 'SEPI', score: -1 };
  if (rvol < 1.0)  return { label: 'NORMAL', score: 0 };
  if (rvol < 1.5)  return { label: 'RAMAI', score: 1 };
  if (rvol < 2.0)  return { label: 'AKTIF', score: 2 };
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
function calculateBDR(volumes, closes, rvol) {
  const n   = 20;
  const rv  = volumes.slice(-n);
  const avgV = avg(rv);
  let big = 0;
  for (let i = 1; i < rv.length; i++) {
    if (rv[i] > avgV * 1.5 && closes[closes.length - n + i] >= closes[closes.length - n + i - 1]) big++;
  }
  const c1 = closes[closes.length - 1];
  const c2 = closes[closes.length - 2];
  const c3 = closes[closes.length - 3];
  if (rvol > 2   && big >= 4 && c1 >= c2 && c2 >= c3) return { label: 'BIG ACC', score: 3 };
  if (rvol > 1.4 && big >= 2)                          return { label: 'AKUM',    score: 2 };
  if (rvol < 0.6 && c1 < c2)                           return { label: 'DIST',    score: -2 };
  return                                                 { label: '',        score: 0 };
}

// ===== PWR =====
function calculatePWR(rsi, macd, macdSig, rvol, chg, hist) {
  let s = 0;
  if (rsi < 30)       s += 2;
  else if (rsi < 45)  s += 1;
  else if (rsi > 75)  s -= 2;
  else if (rsi > 65)  s -= 1;
  if (macd > macdSig) s += 1;
  if (hist > 0)       s += 1;
  if (rvol > 2.5)     s += 2;
  else if (rvol > 1.5) s += 1;
  else if (rvol < 0.6) s -= 1;
  if (chg > 3)        s += 1;
  else if (chg < -4)  s -= 2;
  else if (chg < -2)  s -= 1;
  return Math.min(5, Math.max(1, s));
}

// ===== FASE =====
function calculateFASE(rsi, macd, macdSig, chg, wick, hist) {
  const bull   = macd > macdSig;
  const rising = hist > 0;
  if (chg > 3  && bull && rsi > 50 && rsi < 78) return 'BREAKOUT';
  if (wick > 20 && rsi < 52 && bull)             return 'REBOUND';
  if (rsi < 36  && bull && rising)               return 'REBOUND';
  if (chg < -4  && !bull)                        return 'BREAKDOWN';
  if (!bull     && rsi > 65)                     return 'BREAKDOWN';
  return 'SIDEWAYS';
}

// ===== AKSI / SINYAL AKHIR =====
function calculateAKSI(rsi, macd, macdSig, rvol, chg, pwr, fase) {
  const bull = macd > macdSig;
  if (pwr >= 4 && bull && (fase === 'BREAKOUT' || fase === 'REBOUND') && rvol > 1.3) return 'HAKA';
  if (pwr >= 3 && bull && fase !== 'BREAKDOWN') return 'BUY';
  if (fase === 'BREAKDOWN' || (pwr <= 2 && !bull && rsi > 60))                       return 'SELL';
  return 'HOLD';
}

// ===== TP & SL =====
function calculateTPSL(price, atr, fase, aksi, highs, lows) {
  const resist  = Math.max(...highs.slice(-10));
  const support = Math.min(...lows.slice(-10));
  let tp, sl;
  if (aksi === 'SELL') {
    tp = Math.round(price - atr * 1.5);
    sl = Math.round(price + atr * 1.0);
  } else {
    const mult = fase === 'BREAKOUT' ? 2.5 : 2.0;
    tp = Math.round(Math.min(price + atr * mult, resist * 1.02));
    sl = Math.round(Math.max(price - atr * 1.0, support * 0.99));
    if (tp <= price) tp = Math.round(price + atr * 1.5);
    if (sl >= price) sl = Math.round(price - atr * 0.8);
  }
  return { tp, sl };
}

module.exports = {
  avg,
  calculateRSI,    getRSISignal,
  calculateMACD,   getMACDSignal,
  calculateRVOL,   getRVOLSignal,
  calculateATR,    calculateCHG,
  calculateWick,   calculateBDR,
  calculatePWR,    calculateFASE,
  calculateAKSI,   calculateTPSL
};