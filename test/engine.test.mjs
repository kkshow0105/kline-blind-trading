import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {loadMarket,decide,snapshot,validLog,results} from "../docs/engine.mjs";
const sample=JSON.parse(readFileSync(new URL("../docs/data/sample.json",import.meta.url)));
const market=loadMarket(sample);

test("真实样本、历史切片、持仓限制与候选跳转",()=>{
  assert.equal(market.count,243);
  assert.equal(snapshot(market,[]).bars.length,61);
  assert.equal(snapshot(market,[]).bars.at(-1).date,"2018-01-02");
  const held=decide(market,[],"buy");
  for(const action of ["buy","scan","watch"])assert.throws(()=>decide(market,held,action));
  const second=decide(market,held,"hold");
  assert.equal(snapshot(market,second).holding.date,"2018-01-02");
  const flat=decide(market,second,"sell");
  assert.equal(snapshot(market,flat).holding,null);
  const skipped=decide(market,flat,"scan");
  assert.ok(skipped.slice(flat.length).every(x=>x==="watch"));
  assert.ok(snapshot(market,skipped).hint || snapshot(market,skipped).step===243);
  assert.equal(results(market,skipped),null);
  assert.equal(validLog(["buy","buy"],243),false);
});

test("逐日完成，手动收盘成交，费用、回撤及期末估值",()=>{
  let log=[];
  for(let i=0;i<market.count;i++){
    const action=({0:"buy",1:"hold",2:"sell",242:"buy"})[i]??"watch";
    log=decide(market,log,action);
  }
  const {manual,g1}=results(market,log);
  const bars=market.quotes.slice(market.first);
  const expected=bars[2].c*.9995*.9997/(bars[0].c*1.0005*1.0003);
  const ending=expected/(1.0005*1.0003);
  assert.ok(Math.abs(manual.net-(ending-1)*100)<1e-11);
  assert.equal(manual.trades[0].sell,bars[2].date);
  assert.equal(manual.trades[0].exit,bars[2].c);
  assert.equal(manual.trades[0].days,2);
  assert.equal(manual.trades[1].sell,null);
  assert.equal(manual.trades[1].mark,bars.at(-1).c);
  assert.equal(manual.closed,1);
  assert.equal(manual.open,1);
  assert.equal(g1.closed,4);
  assert.equal(g1.net.toFixed(2),"6.82");
  assert.equal(g1.drawdown.toFixed(2),"-4.41");
  assert.throws(()=>decide(market,log,"watch"));
});

test("原记录只读验算（提供本机文件时运行）",{skip:!process.env.KLINE_REFERENCE},()=>{
  const {progress}=JSON.parse(readFileSync(process.env.KLINE_REFERENCE));
  assert.equal(validLog(progress.log,market.count),true);
  const {manual}=results(market,progress.log);
  assert.equal(manual.closed,20);
  assert.equal(manual.open,0);
  assert.equal(manual.net.toFixed(2),"-4.35");
  assert.equal(manual.drawdown.toFixed(2),"-15.79");
});
