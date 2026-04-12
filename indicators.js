const TI = require('technicalindicators');

// ===== RSI =====
function calculateRSI(closes) {
  try {
    const rsi = TI.RSI.calculate({ values: closes, period: 14 });
    return rsi.length ? parseFloat(rsi[rsi.length - 1].toFixed(2)) : null;
  } catch { return null; }
}

function getRSISignal(rsi) {
  if (rsi === null) return { label: '⚪ NO DATA', score: 0 };
  if (rsi < 30)    return { label: '🟢 OVERSOLD', score: 3 };
  if (rsi < 45)    return { label: '🟡 MULAI PULIH', score: 2 };
  if (rsi < 55)    return { label: '⚪ NETRAL', score: 0 };
  if (rsi < 70)    return { label: '🔵 BULLISH', score: 1 };
  return             { label: '🔴 OVERBOUGHT', score: -1 };
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
    if (!result.length) return { macd: null, prev: null };
    return {
      macd: parseFloat(result[result.length - 1].MACD.toFixed(4)),
      prev: parseFloat(result[result.length - 2]?.MACD?.toFixed(4) ?? 0)
    };
  } catch { return { macd: null, prev: null }; }
}

function getMACDSignal(macd, prev) {
  if (macd === null) return { label: '⚪ NO DATA', score: 0 };
  if (macd > 0 && prev <= 0) return { label: '🟢 GOLDEN CROSS', score: 3 };
  if (macd < 0 && prev >= 0) return { label: '🔴 DEATH CROSS', score: -2 };
  if (macd > 0)              return { label: '🔵 BULLISH', score: 2 };
  if (macd < 0)              return { label: '🔴 BEARISH', score: -1 };
  return                       { label: '⚪ NETRAL', score: 0 };
}

// ===== RVOL =====
function calculateRVOL(volumes) {
  if (volumes.length < 21) return null;
  const avg20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  if (avg20 === 0) return null;
  return parseFloat((volumes[volumes.length - 1] / avg20).toFixed(2));
}

function getRVOLSignal(rvol) {
  if (rvol === null)  return { label: '⚪ NO DATA', score: 0 };
  if (rvol < 0.6)    return { label: '😴 SEPI', score: -1 };
  if (rvol < 1.0)    return { label: '⚪ NORMAL', score: 0 };
  if (rvol < 1.5)    return { label: '🟡 RAMAI', score: 1 };
  if (rvol < 2.0)    return { label: '🟠 AKTIF', score: 2 };
  return               { label: '🔥 BANDAR MASUK', score: 3 };
}

// ===== BDR =====
function calculateBDR(closes, rvol) {
  if (closes.length < 3 || rvol === null) return { label: '— NONE', score: 0 };
  const [c1, c2, c3] = closes.slice(-3);
  const consecutiveUp = c3 > c2 && c2 > c1;

  if (rvol >= 2.0 && consecutiveUp)  return { label: '🚀 BIG ACC', score: 3 };
  if (rvol >= 1.3 && consecutiveUp)  return { label: '📈 AKUM', score: 2 };
  if (rvol >= 1.5 && c3 < c2)        return { label: '⚠️ DIST', score: -2 };
  return                               { label: '— NONE', score: 0 };
}

// ===== SINYAL AKHIR =====
function getFinalSignal(rsiScore, macdScore, rvolScore, bdrScore, macdVal) {
  if (macdVal !== null && macdVal < 0 && macdScore <= -1) return '🔴 SELL';
  if (rvolScore === -1) return '🟡 HOLD';

  const scores = [rsiScore, macdScore, rvolScore, bdrScore];
  const metCount = scores.filter(s => s >= 2).length;
  const totalScore = scores.reduce((a, b) => a + b, 0);

  if (metCount === 4)    return '🚀 HAKA';
  if (metCount >= 2)     return '✅ BUY';
  if (totalScore > 0)    return '🟡 HOLD';
  return                  '🔴 SELL';
}

module.exports = {
  calculateRSI, getRSISignal,
  calculateMACD, getMACDSignal,
  calculateRVOL, getRVOLSignal,
  calculateBDR,
  getFinalSignal
};