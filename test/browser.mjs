// Dependency-free Chromium smoke test. It uses a temporary profile and its own server.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as wait} from "node:timers/promises";

const browser=process.env.KLINE_BROWSER;
if(!browser)throw new Error("Set KLINE_BROWSER to an installed Edge or Chrome executable.");
const profile=await mkdtemp(join(tmpdir(),"kline-browser-"));
const mount="/kline-blind-trading/";
let release="1.0.0";
const types={html:"text/html",mjs:"text/javascript",js:"text/javascript",css:"text/css",
  png:"image/png",json:"application/json",webmanifest:"application/manifest+json"};
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,"http://localhost").pathname;
    if(!path.startsWith(mount))throw new Error();
    const name=path.slice(mount.length)||"index.html";
    const content=await readFile(new URL("../docs/"+name,import.meta.url));
    res.setHeader("Content-Type",types[name.split(".").at(-1)]??"application/octet-stream");
    res.setHeader("Cache-Control",name==="release.json" ? "max-age=86400" : "no-cache");
    res.end(["release.json","sw.js","pwa.mjs"].includes(name) ? content.toString().replaceAll("1.0.0",release) : content);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+server.address().port;
const url=origin+mount;
const processHandle=spawn(browser,["--headless=new","--no-first-run","--disable-background-networking",
  "--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{stdio:"ignore",windowsHide:true});
let socket;
async function eventually(fn,label) {
  for(let i=0;i<150;i++){
    try{const value=await fn();if(value)return value;}catch{}
    await wait(80);
  }
  throw new Error("Timed out: "+label);
}
try{
  const port=await eventually(async()=>String(await readFile(join(profile,"DevToolsActivePort"))).split(/\r?\n/)[0],"DevTools");
  const pages=await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
  socket=new WebSocket(pages.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener("open",resolve,{once:true}));
  let id=0;
  const pending=new Map(), errors=[];
  socket.addEventListener("message",event=>{
    const m=JSON.parse(event.data);
    if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.text);
    const callback=pending.get(m.id);
    if(callback){
      pending.delete(m.id);
      if(m.error)callback.reject(new Error(m.error.message));else callback.resolve(m.result);
    }
  });
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{
    pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  });
  const js=async expression=>{
    const r=await cdp("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
    return r.result.value;
  };
  const ready=(expr)=>eventually(()=>js(expr),expr);
  const el=id=>"document.getElementById("+JSON.stringify(id)+")";
  const txt=id=>js(el(id)+".textContent");
  const visible=id=>ready(el(id)+".checkVisibility()");
  const click=id=>js(el(id)+".click()");
  const step=async(id,expected)=>{
    await click(id);await ready(el("step")+".textContent==="+JSON.stringify(expected+" / 243"));
  };
  async function resize(width,height){
    await cdp("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:2,mobile:true});
    await ready("window.innerWidth==="+width);
    assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"),true);
  }
  async function screenshot(name){
    if(!process.env.KLINE_SCREENSHOTS)return;
    const {data}=await cdp("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(join(process.env.KLINE_SCREENSHOTS,name+".png"),Buffer.from(data,"base64"));
  }
  const touch=(type,points)=>cdp("Input.dispatchTouchEvent",{type,touchPoints:points.map(([x,y,id])=>({x,y,id}))});
  async function reload(){
    await cdp("Page.reload");
    await ready("document.readyState==='complete' && document.getElementById('workspace')?.checkVisibility()");
  }
  await cdp("Page.enable");await cdp("Runtime.enable");await cdp("Network.enable");
  await cdp("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
  await cdp("Page.navigate",{url});
  await visible("workspace");
  assert.equal(await txt("day"),"2018-01-02");
  assert.equal(await txt("score"),"");
  await ready("!!navigator.serviceWorker.controller");
  await ready(el("offline")+".textContent.includes('可离线')");
  const {data:manifest}=await cdp("Page.getAppManifest");
  assert.equal(JSON.parse(manifest).display,"standalone");
  const install=await cdp("Page.getInstallabilityErrors");
  assert.deepEqual(install.installabilityErrors,[]);
  for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[812,375]]){
    await resize(width,height);
    assert.equal(await js(el("chart")+".getBoundingClientRect().height>=140"),true);
    assert.equal(await js(el("buy")+".getBoundingClientRect().height>=44"),true);
    if(width<height){
      assert.equal(await js(el("buy")+".getBoundingClientRect().bottom<=innerHeight"),true);
      await screenshot("blind-"+width);
      await ready(el("chart")+".getBoundingClientRect().bottom<="+el("controls")+".getBoundingClientRect().top");
    }
    assert.equal(await js(el("share")+".checkVisibility()"),false);
    await screenshot("blind-"+width);
  }
  await resize(390,844);
  const box=await js("document.getElementById('chart').getBoundingClientRect().toJSON()");
  const y=Math.round(box.top+85);
  const before=await js(el("chart")+".toDataURL()");
  await touch("touchStart",[[60,y,1]]);await touch("touchMove",[[180,y,1]]);
  await touch("touchEnd",[]);
  await ready(el("chart")+".toDataURL()!=="+JSON.stringify(before));
  const panned=await js(el("chart")+".toDataURL()");
  await touch("touchStart",[[110,y,1],[210,y,2]]);
  await touch("touchMove",[[59,y,1],[270,y,2]]);
  await touch("touchEnd",[]);
  await ready(el("chart")+".toDataURL()!=="+JSON.stringify(panned));
  await touch("touchStart",[[104,y,1]]);await touch("touchEnd",[]);
  assert.equal(await txt("chart-end"),"已揭示至 2018-01-02");
  await step("watch",2);await step("buy",3);
  assert.equal(await js(el("scan")+".checkVisibility()"),false);
  await step("hold",4);await step("sell",5);
  await click("scan");
  await ready("Number(document.getElementById('step').textContent.split('/')[0])>5");
  const saved=await txt("day");
  await cdp("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await reload();
  await ready(el("day")+".textContent==="+JSON.stringify(saved));
  const dayIndex=Number((await txt("step")).split("/")[0]);
  await step("buy",dayIndex+1);await step("sell",dayIndex+2);
  const offlineSaved=await txt("day");
  await cdp("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  release="1.0.1";
  await js("window.dispatchEvent(new Event('online'))");
  await ready(el("update-label")+".textContent.includes('1.0.1')");
  await click("update");
  await ready(el("version")+".textContent==='K线盲测 v1.0.1'");
  assert.equal(await txt("day"),offlineSaved);
  await cdp("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await js(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,0));
    const q=id=>document.getElementById(id);
    for(let i=0;i<243&&!q("reveal").checkVisibility();i++){
      const previous=q("step").textContent;
      q("watch").click();
      while(q("step").textContent===previous)await wait();
    }
  })()`);
  assert.equal(await txt("score"),"");
  await click("reveal");await visible("report");
  assert.match(await txt("score"),/^[+-]?\d+\.\d{2}%$/);
  for(const [w,h] of [[320,568],[375,667],[390,844],[430,932],[812,375]]){
    await resize(w,h);
    await js(el("report")+".scrollIntoView()");
    await screenshot("score-"+w);
  }
  await js(`Object.defineProperty(navigator,"canShare",{configurable:true,value:()=>true});
   Object.defineProperty(navigator,"share",{configurable:true,value:async x=>{
     window.testShare=[x.files[0].type,x.files[0].size];
   }});`);
  await click("share");
  await ready("window.testShare?.[0]==='image/png' && window.testShare?.[1]>10000");
  await js("Object.defineProperty(navigator,'canShare',{value:()=>false})");
  await click("share");await visible("share-dialog");
  assert.equal(await js(el("save-image")+".download.endsWith('.png')"),true);
  await ready(el("share-preview")+".naturalWidth===900");
  await screenshot("share");
  await js(el("share-dialog")+".close()");
  await click("reset");await visible("confirm");
  const originalScore=await txt("score");
  await js(el("confirm")+".querySelector('[value=cancel]').click()");
  assert.equal(await txt("score"),originalScore);
  await click("reset");
  await js(el("confirm")+".querySelector('[value=clear]').click()");
  await ready(el("step")+".textContent==='1 / 243'");
  assert.equal(await txt("score"),"");
  await reload();
  await ready(el("step")+".textContent==='1 / 243'");
  await step("buy",2);
  assert.deepEqual(errors,[]);
  console.log("PASS: Edge installability, five mobile layouts, touch pan/pinch/tap, 243-day flow, offline reload and trade, v1.0.1 update with progress, share PNG, reset/cancel");
}finally{
  socket?.close();
  processHandle.kill();
  server.close();
}
