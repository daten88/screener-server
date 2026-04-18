const TI=require('technicalindicators');
function avg(arr){if(!arr.length)return 0;return arr.reduce((a,b)=>a+b,0)/arr.length;}
function calculateRSI(closes,period=14){try{const rsi=TI.RSI.calculate({values:closes,period});return rsi.length?parseFloat(rsi[rsi.length-1].toFixed(2)):50;}catch{return 50;}}
function getRSISignal(rsi){if(rsi<30)return{label:'OVERSOLD',score:3};if(rsi<45)return{label:'MULAI PULIH',score:2};if(rsi<55)return{label:'NETRAL',score:0};if(rsi<70)return{label:'BULLISH',score:1};return{label:'OVERBOUGHT',score:-1};}
function calculateMACD(closes){try{const result=TI.MACD.calculate({values:closes,fastPeriod:12,slowPeriod:26,signalPeriod:9,SimpleMAOscillator:false,SimpleMASignal:false});if(!result.length)return{macd:0,signal:0,hist:0,macdPrev:0,signalPrev:0,goldenCross:false,deathCross:false,zone:'BEAR_ZONE'};const last=result[result.length-1];const prev=result.length>=2?result[result.length-2]:last;const macdNow=parseFloat((last.MACD??0).toFixed(2));const sigNow=parseFloat((last.signal??0).toFixed(2));const histNow=parseFloat((last.histogram??0).toFixed(2));const macdPrev=parseFloat((prev.MACD??0).toFixed(2));const sigPrev=parseFloat((prev.signal??0).toFixed(2));const goldenCross=macdPrev<sigPrev&&macdNow>sigNow;const deathCross=macdPrev>sigPrev&&macdNow<sigNow;let zone;if(macdPrev<0&&macdNow>=0)zone='ZERO_CROSS_UP';else if(macdPrev>0&&macdNow<=0)zone='ZERO_CROSS_DOWN';else if(macdNow>0)zone='BULL_ZONE';else zone='BEAR_ZONE';return{macd:macdNow,signal:sigNow,hist:histNow,macdPrev,signalPrev:sigPrev,goldenCross,deathCross,zone};}catch{return{macd:0,signal:0,hist:0,macdPrev:0,signalPrev:0,goldenCross:false,deathCross:false,zone:'BEAR_ZONE'};}}
function getMACDSignal(macd,signal,goldenCross,deathCross){if(goldenCross)return{label:'GOLDEN CROSS',score:3};if(deathCross)return{label:'DEATH CROSS',score:-3};if(macd>signal)return{label:'BULLISH',score:2};if(macd<signal)return{label:'BEARISH',score:-1};return{label:'NETRAL',score:0};}
function getZoneLabel(zone){switch(zone){case'ZERO_CROSS_UP':return'ZERO CROSS UP';case'ZERO_CROSS_DOWN':return'ZERO CROSS DOWN';case'BULL_ZONE':return'BULL ZONE';default:return'BEAR ZONE';}}
function calculateRVOL(volumes){if(volumes.length<21)return 1;const avg20=avg(volumes.slice(-21,-1));if(avg20===0)return 1;return parseFloat((volumes[volumes.length-1]/avg20).toFixed(2));}
function getRVOLSignal(rvol){if(rvol<0.6)return{label:'SEPI',score:-1};if(rvol<1.0)return{label:'NORMAL',score:0};if(rvol<1.5)return{label:'RAMAI',score:1};if(rvol<2.0)return{label:'AKTIF',score:2};return{label:'BANDAR MASUK',score:3};}
function calculateATR(highs,lows,closes,period=14){const trs=[];for(let i=1;i<highs.length;i++){trs.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));}return avg(trs.slice(-period));}
function calculateCHG(price,prevClose){if(!prevClose)return 0;return parseFloat(((price-prevClose)/prevClose*100).toFixed(2));}
function calculateWick(highs,lows,closes){const h=highs[highs.length-1]||0;const l=lows[lows.length-1]||0;const c=closes[closes.length-1]||1;const pv=closes[closes.length-2]||c;return(Math.min(c,pv)-l)/(h-l||1)*100;}
function calculateBDR(volumes,closes,rvol,rsi,wick){const n=20;const rv=volumes.slice(-n);const avgV=avg(rv);let bigUp=0,bigDown=0;for(let i=1;i<rv.length;i++){const volBesar=rv[i]>avgV*1.5;const hargaNaik=closes[closes.length-n+i]>closes[closes.length-n+i-1];const hargaTurun=closes[closes.length-n+i]<=closes[closes.length-n+i-1];if(volBesar&&hargaNaik)bigUp++;if(volBesar&&hargaTurun)bigDown++;}const c1=closes[closes.length-1];const c2=closes[closes.length-2];const c3=closes[closes.length-3];if(rvol>2&&bigUp>=4&&c1>=c2&&c2>=c3)return{label:'BIG ACC',score:3};if(rvol>1.4&&bigUp>=2)return{label:'AKUM',score:2};if(rvol>1.5&&bigDown>=2&&c1<c2&&rsi<40){if(wick>25)return{label:'AKUM',score:2};return{label:'AKUM?',score:1};}if(rvol>1.5&&bigDown>=2&&c1<c2&&rsi<45&&wick>30)return{label:'AKUM?',score:1};if(rvol>1.5&&bigDown>=3&&c1<c2&&rsi>55)return{label:'DIST',score:-2};if(rvol>1.2&&bigDown>=2&&c1<c2&&c2<c3&&rsi>50)return{label:'DIST',score:-2};return{label:'',score:0};}
function calculatePWR(rsi,macd,macdSig,rvol,chg,hist,goldenCross,deathCross){let s=0;if(rsi<30)s+=2;else if(rsi<45)s+=1;else if(rsi>75)s-=2;else if(rsi>65)s-=1;if(macd>macdSig)s+=1;if(hist>0)s+=1;if(rvol>2.5)s+=2;else if(rvol>1.5)s+=1;else if(rvol<0.6)s-=1;if(chg>3)s+=1;else if(chg<-4)s-=2;else if(chg<-2)s-=1;if(goldenCross)s+=2;if(deathCross)s-=2;return Math.min(5,Math.max(1,s));}
function calculateFASE(rsi,macd,macdSig,chg,wick,hist){const bull=macd>macdSig;const rising=hist>0;if(chg>3&&bull&&rsi>50&&rsi<78)return'BREAKOUT';if(wick>20&&rsi<52&&bull)return'REBOUND';if(rsi<36&&bull&&rising)return'REBOUND';if(chg<-4&&!bull)return'BREAKDOWN';if(!bull&&rsi>65)return'BREAKDOWN';return'SIDEWAYS';}
function calculateAKSI(rsi,macd,macdSig,rvol,chg,pwr,fase,goldenCross,deathCross,bdr,zone){
  const bull=macd>macdSig;
  const bullZone=zone==='BULL_ZONE'||zone==='ZERO_CROSS_UP';
  const bearZone=zone==='BEAR_ZONE'||zone==='ZERO_CROSS_DOWN';

  // SELL prioritas tertinggi
  // Death Cross + Bull Zone = kemungkinan false signal (koreksi dalam uptrend)
  // Konfirmasi via FASE dan RSI sebelum SELL
  if(deathCross&&bullZone){
    if(fase==='BREAKDOWN')return'SELL';            // breakdown nyata → SELL valid
    if(fase==='SIDEWAYS'&&rsi<50)return'SELL';     // momentum melemah → SELL valid
    return'HOLD';                                   // BREAKOUT/REBOUND atau RSI kuat → tahan
  }
  // Death Cross di Bear Zone = langsung SELL (konfirmasi penuh)
  if(deathCross)return'SELL';
  if(bdr==='DIST'&&!bull)return'SELL';
  if(rsi>70&&!bull)return'SELL';
  if(fase==='BREAKDOWN')return'SELL';
  if(pwr<=2&&!bull&&rsi>60)return'SELL';

  // Proteksi DIST
  if(bdr==='DIST'&&bullZone)return'HOLD';
  if(goldenCross&&bearZone&&bdr==='DIST')return'SELL';

  // Golden Cross
  if(goldenCross&&bull&&rvol>1.0)return bearZone?'BUY':'HAKA';

  // AKUM terselubung
  if(bdr==='AKUM'&&bull&&rsi<45&&fase!=='BREAKDOWN')return'BUY';

  // HAKA normal
  if(pwr>=4&&bull&&(fase==='BREAKOUT'||fase==='REBOUND')&&rvol>1.3){
    return bullZone?'HAKA':'BUY';
  }

  // BUY standar
  if(pwr>=3&&bull&&fase!=='BREAKDOWN'){
    // Pengecualian bear zone: potensi bottom/rebound kuat
    if(bearZone&&pwr>=4&&rsi<45&&fase==='REBOUND')return'BUY';
    if(bearZone&&pwr>=5&&rsi<50)return'BUY';
    return bearZone?'HOLD':'BUY';
  }

  return'HOLD';
}
function getFraksi(price){if(price<200)return 1;if(price<500)return 2;if(price<2000)return 5;if(price<5000)return 10;return 25;}
function roundToFraksi(price,fraksi){return Math.round(price/fraksi)*fraksi;}
function calculateTPSL(price,atr,fase,aksi,highs,lows){const resist=Math.max(...highs.slice(-10));const support=Math.min(...lows.slice(-10));const fraksi=getFraksi(price);let tp,sl;if(aksi==='SELL'){tp=roundToFraksi(price-atr*1.5,fraksi);sl=roundToFraksi(price+atr*1.0,fraksi);}else{const mult=fase==='BREAKOUT'?2.5:2.0;tp=roundToFraksi(Math.min(price+atr*mult,resist*1.02),fraksi);sl=roundToFraksi(Math.max(price-atr*1.0,support*0.99),fraksi);if(tp<=price)tp=roundToFraksi(price+atr*1.5,fraksi);if(sl>=price)sl=roundToFraksi(price-atr*0.8,fraksi);}return{tp,sl};}
function calculateEntry(price,atr,fase,aksi,highs,lows){const fraksi=getFraksi(price);const support=Math.min(...lows.slice(-10));let e1,e2,e3;if(aksi==='SELL')return{e1:null,e2:null,e3:null};if(fase==='BREAKOUT'){e1=roundToFraksi(price,fraksi);e2=roundToFraksi(price-atr*0.3,fraksi);e3=roundToFraksi(price-atr*0.6,fraksi);}else if(fase==='REBOUND'){e1=roundToFraksi(price,fraksi);e2=roundToFraksi(price-atr*0.5,fraksi);e3=roundToFraksi(Math.max(support*1.01,price-atr*1.0),fraksi);}else{e1=roundToFraksi(price,fraksi);e2=roundToFraksi(price-atr*0.4,fraksi);e3=roundToFraksi(price-atr*0.8,fraksi);}const sl=roundToFraksi(Math.max(price-atr*1.0,support*0.99),fraksi);if(e3<=sl)e3=roundToFraksi(sl+fraksi*2,fraksi);if(e2<=sl)e2=roundToFraksi(sl+fraksi*4,fraksi);return{e1,e2,e3};}
module.exports={avg,calculateRSI,getRSISignal,calculateMACD,getMACDSignal,getZoneLabel,calculateRVOL,getRVOLSignal,calculateATR,calculateCHG,calculateWick,calculateBDR,calculatePWR,calculateFASE,calculateAKSI,calculateTPSL,calculateEntry,getFraksi,roundToFraksi};
