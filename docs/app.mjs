import {loadMarket,decide,snapshot,validLog,results} from "./engine.mjs";
import {readProgress,writeProgress} from "./storage.mjs";
import {createChart} from "./chart.mjs";
import {setupPwa} from "./pwa.mjs";
import {shareScore} from "./share.mjs";

const el=id=>document.getElementById(id);
const px=v=>v==null ? "—" : v.toFixed(3);
const pct=(v,signed=true)=>v==null ? "—" : (signed && v>0 ? "+" : "")+v.toFixed(2)+"%";
const n=v=>typeof v==="number" ? v.toFixed(2) : v??"—";
const tone=v=>v>0 ? "up" : v<0 ? "down" : "";
const labels={buy:"买入",watch:"观望",sell:"卖出",hold:"继续持有"};
const status=message=>{el("status").textContent=message;};
let market,key,progress,view,report=null,busy=false,updating=false,confirmState,shareUrl;
const actionButtons=[...document.querySelectorAll(".decisions button"),el("reset")];
const syncActions=()=>actionButtons.forEach(button=>{button.disabled=busy||updating;});
new ResizeObserver(([entry])=>{
  if(entry.target.hidden)return;
  document.documentElement.style.setProperty("--dock",entry.target.getBoundingClientRect().height+"px");
}).observe(el("controls"));

function pair(label,value,cls="") {
  const group=document.createElement("div"), term=document.createElement("dt"), desc=document.createElement("dd");
  term.textContent=label;desc.textContent=value;desc.className=cls;group.append(term,desc);
  return group;
}
const chart=createChart(el("chart"),bar=>{
  if(!bar)return;
  el("quotes").replaceChildren(pair("日期",bar.date),pair("开",px(bar.o)),pair("高",px(bar.h)),
    pair("低",px(bar.l)),pair("收",px(bar.c)),pair("涨跌",pct(bar.change),tone(bar.change)),
    pair("成交量",bar.vol.toLocaleString("zh-CN")));
  el("ma").replaceChildren(...bar.ma.map((v,i)=>{
    const entry=document.createElement("span");
    entry.textContent="MA"+[5,10,20][i]+" "+(v?.toFixed(4)??"—");
    return entry;
  }));
});

function markers() {
  const indices=new Map(view.bars.map((b,i)=>[b.date,i]));
  return Object.entries(report??{}).filter(([key])=>key==="manual" || key==="g1")
    .flatMap(([key,summary])=>summary.trades.flatMap(t=>[
      {i:indices.get(t.buy),price:t.entry,buy:true,g1:key==="g1"},
      ...(t.sell ? [{i:indices.get(t.sell),price:t.exit,buy:false,g1:key==="g1"}] : []),
    ]));
}
function draw() {
  view=snapshot(market,progress.log);
  const current=view.bars.at(-1);
  el("workspace").hidden=false;
  el("day").textContent=current.date;
  el("step").textContent=view.finished ? "决定已锁定" : view.step+" / "+market.count;
  el("progress").max=market.count;el("progress").value=view.finished ? market.count : view.step;
  el("position").textContent=view.holding ? "持仓中" : "空仓";
  el("hint").textContent=view.hint ? "候选 "+view.hint : "无候选提示";
  el("position-detail").hidden=!view.holding;
  if(view.holding)el("position-detail").textContent="买入 "+view.holding.date+" · "+px(view.holding.c)+
    " · 买入日低点 "+px(view.holding.l)+" · MA5 "+(current.ma[0]?.toFixed(4)??"—");
  el("flat").hidden=view.finished || Boolean(view.holding);
  el("holding").hidden=view.finished || !view.holding;
  el("reveal").hidden=!view.finished || Boolean(report);
  el("controls").hidden=Boolean(report);
  document.body.classList.toggle("active",!report);
  el("report").hidden=!report;
  el("chart-start").textContent=view.bars[0].date;
  el("chart-end").textContent="已揭示至 "+current.date;
  chart.render(view.bars,markers());
}
function discardReport() {
  report=null;
  el("trade-detail").hidden=true;
  for(const id of ["score","score-caption","metrics","baseline","trades","baseline-trades","candidates","trade-detail"]) {
    el(id).replaceChildren();
  }
  if(shareUrl)URL.revokeObjectURL(shareUrl);
  shareUrl=null;el("share-preview").removeAttribute("src");el("save-image").removeAttribute("href");
}

async function commit(action, base=progress) {
  if(busy || updating || !market)return;
  busy=true;
  syncActions();
  try {
    if(action==="reset" && base.log.length!==market.count)return;
    const log=action==="reset" ? [] : decide(market,base.log,action);
    const {next,conflict}=await writeProgress(key,base,log);
    progress=next;
    if(conflict || action==="reset"){discardReport();chart.reset();}
    draw();
    status(conflict ? "另一窗口已更新进度，当前页面已同步。" : "");
    if(!conflict && action==="reset") window.scrollTo(0,0);
  } catch (error) {status(error.message==="保存失败" ? "保存失败，请重试。当前决定未推进。" : "未能保存或执行决定，请刷新核对进度。");}
  finally {busy=false;syncActions();}
}

const sections=[
  ["最大回撤","drawdown",pct],["完成交易","closed",String],["盈利笔数","wins",String],["亏损笔数","losses",String],
  ["胜率","hit",v=>pct(v,false)],["平均单笔盈利","avgWin",pct],["平均单笔亏损","avgLoss",pct],
  ["平均盈亏比","payoff",n],["最长连续亏损","streak",String],["利润因子","factor",n],
  ["最大单笔盈利","best",pct],["最大单笔亏损","worst",pct],["平均持仓交易日","avgDays",n],
  ["期末未平仓","open",String],["期末浮动收益","floating",pct],
];
function tradeCards(id, trades, manual) {
  el(id).replaceChildren(...trades.map(t=>{
    const card=document.createElement("article");card.className="trade";
    const head=document.createElement("header"), button=document.createElement("button"), net=document.createElement("strong");
    button.type="button";button.textContent=t.buy;
    button.onclick=()=>{
      chart.all();chart.focus(view.bars.findIndex(b=>b.date===t.buy));
      el("trade-detail").hidden=false;
      el("trade-detail").textContent=(manual ? "人工（黄色）" : "原 G1（蓝色）")+" · "+t.buy+" 买入 "+
        px(t.entry)+(t.sell ? " → "+t.sell+" 卖出 "+px(t.exit) : " · 期末估值 "+px(t.mark))+" · "+pct(t.net);
      el("workspace").scrollIntoView({block:"start"});
    };
    net.textContent=(t.sell?"":"浮动 ")+pct(t.net);net.className=tone(t.net);head.append(button,net);
    const detail=document.createElement("dl");
    detail.append(pair("买入价",px(t.entry)),pair("买入日低点",px(t.stop)),pair("卖出日",t.sell??"—"),
      pair(t.sell?"卖出价":"期末估值",px(t.exit??t.mark)),pair("持仓交易日",t.days),pair("退出原因",t.reason));
    if(manual)detail.append(pair("最高浮盈",pct(t.mfe)),pair("最大不利波动",pct(t.mae)));
    card.append(head,detail);return card;
  }));
  if(!trades.length)el(id).textContent="本轮没有开仓。";
}
function reveal() {
  if(busy || !(report=results(market,progress.log)))return;
  const {manual,g1,candidates}=report;
  el("score").textContent=pct(manual.net);el("score").className=tone(manual.net);
  el("score-caption").textContent=(manual.net===0?"持平":(manual.net>0?"盈利 ":"亏损 ")+Math.abs(manual.net).toFixed(2)+"%")+
    " · 已扣除交易成本";
  const metrics=(id,summary,withNet)=>el(id).replaceChildren(
    ...(withNet?[pair("累计净收益",pct(summary.net),tone(summary.net))]:[]),
    ...sections.map(([label,k,format])=>pair(label,format(summary[k]))));
  metrics("metrics",manual,false);metrics("baseline",g1,true);
  tradeCards("trades",manual.trades,true);tradeCards("baseline-trades",g1.trades,false);
  el("candidates").replaceChildren(...candidates.map(c=>{
    const li=document.createElement("li");li.textContent=c.date+" · "+c.hint+" · "+labels[c.choice];return li;
  }));
  draw();el("report").scrollIntoView({block:"start"});
}

for(const action of ["buy","watch","scan","sell","hold"])el(action).onclick=e=>{if(e.detail<=1)void commit(action);};
el("reveal").onclick=reveal;
el("reset").onclick=()=>{if(report && !busy){confirmState=progress;el("confirm").returnValue="cancel";el("confirm").showModal();}};
el("confirm").addEventListener("close",()=>{if(el("confirm").returnValue==="clear")void commit("reset",confirmState);});
el("zoom-in").onclick=()=>chart.zoom(.72);
el("zoom-out").onclick=()=>chart.zoom(1.38);
el("all").onclick=()=>chart.all();
el("latest").onclick=()=>chart.latest();
el("share").onclick=async()=>{
  if(!report || !view.finished)return;
  try {
    const completed=report;
    const url=await shareScore(completed.manual,market,pct,n);
    if(url){
      if(report!==completed){URL.revokeObjectURL(url);return;}
      if(shareUrl)URL.revokeObjectURL(shareUrl);
      shareUrl=url;el("share-preview").src=url;el("save-image").href=url;
      el("save-image").download="K线盲测成绩-"+market.symbol+".png";
      el("share-dialog").showModal();
    }
  } catch {status("未能生成图片，请重试。");}
};

try {
  const response=await fetch("./data/sample.json");
  if(!response.ok)throw new Error();
  market=loadMarket(await response.json());
  key=new URL("./",location.href).pathname+"|"+market.id;
  progress=await readProgress(key);
  if(!validLog(progress.log,market.count))throw new Error();
  el("instrument").textContent=market.name+" · "+market.symbol+" · 人工买卖";
  draw();
} catch {status("无法读取行情或本机进度。请检查浏览器是否允许站点存储，然后重试。");}
void setupPwa(el,()=>busy,next=>{updating=next;syncActions();});
