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
  } else if(fase === 'REBOUND'){
    e1 = roundToFraksi(price, fraksi);
    e2 = roundToFraksi(price - atr * 0.5, fraksi);
    e3 = roundToFraksi(Math.max(support * 1.01, price - atr * 1.0), fraksi);
  } else {
    // SIDEWAYS / BREAKDOWN
    e1 = roundToFraksi(price, fraksi);
    e2 = roundToFraksi(price - atr * 0.4, fraksi);
    e3 = roundToFraksi(price - atr * 0.8, fraksi);
  }

  // Safety #1: jangan sampai di bawah SL
  const sl = roundToFraksi(Math.max(price - atr * 1.0, support * 0.99), fraksi);
  if(e3 <= sl) e3 = roundToFraksi(sl + fraksi * 2, fraksi);
  if(e2 <= sl) e2 = roundToFraksi(sl + fraksi * 4, fraksi);

  // ✅ Safety #2: paksa urutan E1 >= E2 >= E3 (fix bug invert)
  if(e3 >= e2) e3 = roundToFraksi(e2 - fraksi * 2, fraksi);
  if(e2 >= e1) e2 = roundToFraksi(e1 - fraksi * 2, fraksi);

  // Safety #3: kalau masih invert (ATR sangat kecil / harga sangat murah)
  // → fallback ke spread minimal berdasarkan fraksi
  if(e3 >= e2 || e2 >= e1){
    e1 = roundToFraksi(price, fraksi);
    e2 = roundToFraksi(price - fraksi * 2, fraksi);
    e3 = roundToFraksi(price - fraksi * 4, fraksi);
  }

  return { e1, e2, e3 };
}
