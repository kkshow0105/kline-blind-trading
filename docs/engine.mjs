const BUY = 1.0005 * 1.0003;
const SELL = .9995 * .9997;

function candidate(o,h,l,c) {
  const width = h-l;
  if (width === 0 || 4*(c-l) < 3*width) return "";
  const a = c > o;
  const b = 4*Math.abs(c-o) <= width && 2*(Math.min(c,o)-l) >= width;
  return a && b ? "A+B" : a ? "A" : b ? "B" : "";
}

export function loadMarket(sample) {
  const {id, name, symbol, first, scale, bars} = sample;
  if (!id || !name || !symbol || !Array.isArray(bars) || !Number.isInteger(first) ||
      first < 24 || first >= bars.length || !Number.isSafeInteger(scale) || scale <= 0) {
    throw new Error("样本配置无效");
  }
  const sums = [0];
  const quotes = bars.map(([date,o,h,l,c,vol],i) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || (i && date <= bars[i-1][0]) ||
        ![o,h,l,c,vol].every(Number.isSafeInteger) || l <= 0 || h < Math.max(o,c) ||
        l > Math.min(o,c) || vol <= 0) throw new Error("样本日线无效");
    sums.push(sums.at(-1) + c);
    const sum = (end,n) => sums[end+1]-sums[end+1-n];
    const ma = [5,10,20].map(n=>i>=n-1 ? sum(i,n)/n/scale : null);
    return {date,o:o/scale,h:h/scale,l:l/scale,c:c/scale,vol,ma,
      change:i ? (c/bars[i-1][4]-1)*100 : null,
      hint:i>=first ? candidate(o,h,l,c) : "",
      above:i>=4 && c*5>sum(i,5), below:i>=4 && c*5<sum(i,5),
      strict:i>=first && 100*c<=95*bars[i-10][4] && sum(i,20)<sum(i-5,20) &&
        c>o && c>bars[i-1][2] && h>l && 4*(c-l)>=3*(h-l)};
  });
  return {id,name,symbol,first,quotes,count:quotes.length-first,
    start:quotes[first].date,end:quotes.at(-1).date};
}

export function position(log) {
  for (let i=log.length-1;i>=0;i--) {
    if (log[i]==="buy") return i;
    if (log[i]==="sell") return null;
  }
  return null;
}

export function validLog(log, count) {
  if (!Array.isArray(log) || log.length>count) return false;
  let held=false;
  for (const action of log) {
    if (!(held ? ["sell","hold"] : ["buy","watch"]).includes(action)) return false;
    if (action==="buy" || action==="sell") held=!held;
  }
  return true;
}

export function decide(market, log, action) {
  if (log.length===market.count) throw new Error("测试已结束");
  const held=position(log)!==null;
  if (!(held ? ["sell","hold"] : ["buy","watch","scan"]).includes(action)) {
    throw new Error("当前状态无法执行此操作");
  }
  if (action!=="scan") return [...log,action];
  let end=log.length+1;
  while (end<market.count-1 && !market.quotes[market.first+end].hint) end++;
  return [...log,...Array(end-log.length).fill("watch")];
}

export function snapshot(market, log) {
  const index=market.first+Math.min(log.length,market.count-1);
  const entry=position(log);
  return {index, step:index-market.first+1, finished:log.length===market.count,
    bars:market.quotes.slice(0,index+1).map(({date,o,h,l,c,vol,ma,change})=>({date,o,h,l,c,vol,ma,change})),
    hint:market.quotes[index].hint, holding:entry===null ? null : market.quotes[market.first+entry]};
}

function simulate(market, log) {
  const bars=market.quotes.slice(market.first);
  const manual=log!==null;
  const trades=[], nav=[1];
  let cash=1, trade=null, armed=false;
  bars.forEach((bar,i)=>{
    if (trade) {
      let reason="", px;
      if (manual) {
        if (log[i]==="sell") {reason="人工主动卖出"; px=bar.c;}
      } else {
        if (bar.o<trade.stop) {reason="原始低点止损（跳空）"; px=bar.o;}
        else if (bar.l<trade.stop) {reason="原始低点止损（盘中）"; px=trade.stop;}
        else {
          armed ||= bar.above || (i===trade.index+1 && bars[trade.index].above);
          if (armed && bar.below) {reason="MA5退出"; px=bar.c;}
        }
      }
      if (manual) {
        trade.high=Math.max(trade.high,bar.h);
        trade.low=Math.min(trade.low,bar.l);
      }
      if (reason) {
        const multiple=px*SELL/(trade.entry*BUY);
        Object.assign(trade,{sell:bar.date,exit:px,reason,days:i-trade.index,net:(multiple-1)*100});
        cash*=multiple;
        trade=null;
      }
    }
    if (!trade && (manual ? log[i]==="buy" : bar.strict)) {
      trade={index:i,buy:bar.date,entry:bar.c,stop:bar.l,high:bar.c,low:bar.c};
      trades.push(trade);
      armed=false;
    }
    nav.push(trade ? cash*bar.c/(trade.entry*BUY) : cash);
  });
  if (trade) {
    const mark=bars.at(-1).c;
    Object.assign(trade,{sell:null,exit:null,mark,days:bars.length-1-trade.index,
      net:(mark/(trade.entry*BUY)-1)*100,reason:"期末持仓"});
  }
  let peak=1, drawdown=0, streak=0, longest=0;
  for (const equity of nav) {
    peak=Math.max(peak,equity);
    drawdown=Math.min(drawdown,(equity/peak-1)*100);
  }
  const closed=trades.filter(t=>t.sell);
  const wins=[], losses=[];
  for (const {net} of closed) {
    if (net>0) wins.push(net);
    if (net<0) losses.push(net);
    streak=net<0 ? streak+1 : 0;
    longest=Math.max(longest,streak);
  }
  const sum=ns=>ns.reduce((a,b)=>a+b,0);
  const avg=ns=>ns.length ? sum(ns)/ns.length : null;
  return {trades:trades.map(t=>({...t,mfe:manual ? (t.high/t.entry-1)*100 : null,
      mae:manual ? (t.low/t.entry-1)*100 : null})),net:(nav.at(-1)-1)*100,drawdown,
    closed:closed.length,wins:wins.length,losses:losses.length,streak:longest,open:trade ? 1 : 0,
    hit:closed.length ? wins.length/closed.length*100 : null,avgWin:avg(wins),avgLoss:avg(losses),
    payoff:wins.length && losses.length ? avg(wins)/-avg(losses) : null,
    factor:losses.length ? sum(wins)/-sum(losses) : wins.length ? "∞" : null,
    best:wins.length ? Math.max(...wins) : null,worst:losses.length ? Math.min(...losses) : null,
    avgDays:avg(closed.map(t=>t.days)),floating:trade?.net ?? null};
}

export function results(market, log) {
  if (log.length!==market.count || !validLog(log,market.count)) return null;
  let held=false;
  const candidates=[];
  log.forEach((choice,i)=>{
    const {date,hint}=market.quotes[market.first+i];
    if (hint) candidates.push({date,hint,choice,held});
    if (choice==="buy" || choice==="sell") held=!held;
  });
  return {manual:simulate(market,log),g1:simulate(market,null),candidates};
}
