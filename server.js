const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
server.listen(PORT, function() {
  console.log('Server jalan di port ' + PORT);
});

const WATCHLIST = [
  'AHAP','ARCI','BIPI','BNBR','BRMS','BULL','BUMI','BUVA',
  'CUAN','DATA','DEWA','ENRG','GTSI','HUMI','IMPC','INDY',
  'MBMA','MINA','NINE','PADA','PADI','PANI','PSKT','RAJA',
  'SOFA','TPIA','TRUE','VKTR','WIFI','ZATA'
];

var latestData = {};
var isRefreshing = false;

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

async function fetchOne(ticker) {
  var https = require('https');
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '.JK?interval=1d&range=90d';
  return new Promise(function(resolve) {
    var options = {
      hostname: 'query1.finance.yahoo.com',
      path: '/v8/finance/chart/' + ticker + '.JK?interval=1d&range=90d',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com'
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var j = JSON.parse(data);
          if (!j.chart || !j.chart.result || !j.chart.result[0]) {
            resolve({ ticker: ticker, ok: false, error: 'No data' });
            return;
          }
          var result = j.chart.result[0];
          var meta = result.meta;
          var q = result.indicators.quote[0];
          var ts = result.timestamps || [];
          var cl = ts.map(function(_,i){ return q.close[i]; }).filter(function(v){ return v != null; });
          var hi = ts.map(function(_,i){ return q.high[i]; }).filter(function(v){ return v != null; });
          var lo = ts.map(function(_,i){ return q.low[i]; }).filter(function(v){ return v != null; });
          var vo = ts.map(function(_,i){ return q.volume[i]; }).filter(function(v){ return v != null; });
          if (cl.length < 26) { resolve({ ticker: ticker, ok: false, error: 'Data kurang' }); return; }
          var price = meta.regularMarketPrice || cl[cl.length-1];
          var prev  = meta.previousClose || cl[cl.length-2] || price;
          var chg   = (price - prev) / prev * 100;
          var rsi   = calcRSI(cl, 14);
          var macdR = calcMACD(cl);
          var avgV  = avg(vo.slice(-20));
          var vol   = vo[vo.length-1] || 0;
          var rvol  = vol / (avgV || 1);
          var atr   = calcATR(hi, lo, cl, 14);
          var wick  = calcWick(hi, lo, cl);
          var bdr   = calcBDR(vo, cl, rvol);
          var pwr   = calcPWR(rsi, macdR.macdVal, macdR.macdSig, rvol, chg, macdR.hist);
          var fase  = calcFASE(rsi, macdR.macdVal, macdR.macdSig, chg, wick, macdR.hist);
          var aksi  = calcAKSI(rsi, macdR.macdVal, macdR.macdSig, rvol, chg, pwr, fase);
          var tpsl  = calcTPSL(price, atr, fase, aksi, hi, lo);
          resolve({
            ticker: ticker, ok: true,
            price: price, chg: chg, rsi: rsi,
            macd: macdR.macdVal, macdSig: macdR.macdSig,
            rvol: rvol, bdr: bdr, pwr: pwr,
            fase: fase, aksi: aksi,
            tp: tpsl.tp, sl: tpsl.sl
          });
        } catch(e) {
          resolve({ ticker: ticker, ok: false, error: e.message });
        }
      });
    });
    req.on('error', function(e) {
      resolve({ ticker: ticker, ok: false, error: e.message });
    });
    req.setTimeout(10000, function() {
      req.destroy();
      resolve({ ticker: ticker, ok: false, error: 'Timeout' });
    });
    req.end();
  });
}

function avg(a) { if (!a.length) return 0; var s=0; for(var i=0;i<a.length;i++) s+=a[i]; return s/a.length; }

function calcRSI(c, p) {
  if (c.length < p+1) return 50;
  var g=0, l=0;
  for (var i=c.length-p; i<c.length; i++) { var d=c[i]-c[i-1]; d>0?g+=d:l-=d; }
  var ag=g/p, al=l/p;
  if (al===0) return 100;
  return Math.round(100 - 100/(1+ag/al));
}

function emaCalc(arr, n) { var k=2/(n+1), e=arr[0]; for(var i=1;i<arr.length;i++) e=arr[i]*k+e*(1-k); return e; }

function calcMACD(c) {
  if (c.length < 30) return { macdVal:0, macdSig:0, hist:0 };
  var macdVal = parseFloat((emaCalc(c,12) - emaCalc(c,26)).toFixed(2));
  var line = [];
  for (var i=25; i<c.length; i++) line.push(emaCalc(c.slice(0,i+1),12) - emaCalc(c.slice(0,i+1),26));
  var macdSig = parseFloat(emaCalc(line,9).toFixed(2));
  return { macdVal:macdVal, macdSig:macdSig, hist:parseFloat((macdVal-macdSig).toFixed(2)) };
}

function calcATR(hi, lo, cl, p) {
  var trs=[];
  for (var i=1; i<hi.length; i++) trs.push(Math.max(hi[i]-lo[i], Math.abs(hi[i]-cl[i-1]), Math.abs(lo[i]-cl[i-1])));
  return avg(trs.slice(-p));
}

function calcWick(hi, lo, cl) {
  var h=hi[hi.length-1]||0, l=lo[lo.length-1]||0, c=cl[cl.length-1]||1, pv=cl[cl.length-2]||c;
  return (Math.min(c,pv)-l)/(h-l||1)*100;
}

function calcBDR(vo, cl, rvol) {
  var n=20, rv=vo.slice(-n), av=avg(rv), big=0;
  for (var i=1; i<rv.length; i++) if (rv[i]>av*1.5 && cl[cl.length-n+i]>=cl[cl.length-n+i-1]) big++;
  var c1=cl[cl.length-1], c2=cl[cl.length-2], c3=cl[cl.length-3];
  if (rvol>2 && big>=4 && cl.length>=3 && c1>=c2 && c2>=c3) return 'BIG ACC';
  if (rvol>1.4 && big>=2) return 'AKUM';
  if (rvol<0.6 && c1<c2) return 'DIST';
  return '';
}

function calcPWR(rsi, macd, sig, rvol, chg, hist) {
  var s=0;
  if (rsi<30) s+=2; else if (rsi<45) s+=1; else if (rsi>75) s-=2; else if (rsi>65) s-=1;
  if (macd>sig) s+=1; if (hist>0) s+=1;
  if (rvol>2.5) s+=2; else if (rvol>1.5) s+=1; else if (rvol<0.6) s-=1;
  if (chg>3) s+=1; else if (chg<-4) s-=2; else if (chg<-2) s-=1;
  return Math.min(5, Math.max(1, s));
}

function calcFASE(rsi, macd, sig, chg, wick, hist) {
  var bull=macd>sig, rising=hist>0;
  if (chg>3 && bull && rsi>50 && rsi<78) return 'BREAKOUT';
  if (wick>20 && rsi<52 && bull) return 'REBOUND';
  if (rsi<36 && bull && rising) return 'REBOUND';
  if (chg<-4 && !bull) return 'BREAKDOWN';
  if (!bull && rsi>65) return 'BREAKDOWN';
  return 'SIDEWAYS';
}

function calcAKSI(rsi, macd, sig, rvol, chg, pwr, fase) {
  var bull=macd>sig;
  if (pwr>=4 && bull && (fase==='BREAKOUT'||fase==='REBOUND') && rvol>1.3) return 'HAKA';
  if (pwr>=3 && bull && fase!=='BREAKDOWN') return 'BUY';
  if (fase==='BREAKDOWN' || (pwr<=2 && !bull && rsi>60)) return 'SELL';
  return 'HOLD';
}

function calcTPSL(price, atr, fase, aksi, hi, lo) {
  var resist=Math.max.apply(null, hi.slice(-10));
  var support=Math.min.apply(null, lo.slice(-10));
  var tp, sl;
  if (aksi==='SELL') { tp=Math.round(price-atr*1.5); sl=Math.round(price+atr*1.0); }
  else {
    var mult=fase==='BREAKOUT'?2.5:2.0;
    tp=Math.round(Math.min(price+atr*mult, resist*1.02));
    sl=Math.round(Math.max(price-atr*1.0, support*0.99));
    if (tp<=price) tp=Math.round(price+atr*1.5);
    if (sl>=price) sl=Math.round(price-atr*0.8);
  }
  return { tp:tp, sl:sl };
}

async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  var time = new Date().toLocaleTimeString();
  console.log('[' + time + '] Fetching ' + WATCHLIST.length + ' saham...');
  for (var i=0; i<WATCHLIST.length; i++) {
    latestData[WATCHLIST[i]] = await fetchOne(WATCHLIST[i]);
    await sleep(1000);
  }
  isRefreshing = false;
  console.log('Done. ' + Object.keys(latestData).length + ' saham loaded.');
}

app.get('/health', function(req, res) {
  res.json({ status: 'ok', stocks: Object.keys(latestData).length });
});

app.get('/data', function(req, res) {
  res.json({ data: latestData, ts: Date.now() });
});

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'screener.html'));
});

refreshAll();
setInterval(refreshAll, 120000);