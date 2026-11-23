export const VERSION="1.0.0";
const THROTTLE=60_000;
const isNewer=(a,b)=>{
  if(!/^\d+\.\d+\.\d+$/.test(a))return false;
  const lhs=a.split(".").map(Number),rhs=b.split(".").map(Number);
  const first=lhs.findIndex((v,i)=>v!==rhs[i]);
  return first>=0 && lhs[first]>rhs[first];
};

export async function setupPwa(el,busy,lockDecisions) {
  el("version").textContent="K线盲测 v"+VERSION;
  let prompt;
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();prompt=event;el("install").hidden=false;
  });
  el("install").onclick=async()=>{
    if(prompt){await prompt.prompt();prompt=null;el("install").hidden=true;}
  };
  window.addEventListener("appinstalled",()=>{el("install").hidden=true;});
  if(!("serviceWorker" in navigator))return;
  let registration, accepted=false, checking=false, last=0, target;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    el("offline").textContent="可离线使用";
    if(accepted)location.reload();
  });
  try{
    registration=await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
    void navigator.serviceWorker.ready.then(()=>{el("offline").textContent="可离线使用";});
  }catch{return;}

  async function check(force=false) {
    if(checking || (!force && Date.now()-last<THROTTLE))return;
    checking=true;last=Date.now();
    try{
      const request=new URL("./release.json",location.href);
      request.searchParams.set("check",String(last));
      const response=await fetch(request,{cache:"no-store"});
      if(!response.ok)return;
      const {version}=await response.json();
      if(isNewer(version,VERSION)){
        target=version;
        el("update-label").textContent="发现新版本 v"+target;
        el("update-banner").hidden=false;
        await registration.update();
      }
    }catch{/* 离线时继续使用已缓存的版本。 */}
    finally{checking=false;}
  }
  function installed(worker){
    if(!worker || worker.state!=="installing")return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);worker.removeEventListener("statechange",changed);resolve();};
      const changed=()=>{if(worker.state!=="installing")done();};
      const timer=setTimeout(done,12000);
      worker.addEventListener("statechange",changed);
    });
  }
  el("update").onclick=async()=>{
    if(busy() || !target || accepted)return;
    el("update").disabled=true;
    el("update-label").textContent="正在准备 v"+target+"…";
    try{
      if(!registration.waiting)await registration.update();
      await installed(registration.installing);
      if(!registration.waiting || busy())throw new Error();
      accepted=true;
      lockDecisions(true);
      registration.waiting.postMessage({type:"activate",version:target});
      setTimeout(()=>{
        if(accepted){
          accepted=false;el("update").disabled=false;
          lockDecisions(false);
          el("update-label").textContent="更新尚未应用，可以重试。";
        }
      },12000);
    }catch{
      accepted=false;lockDecisions(false);
      el("update-label").textContent="新版本尚未下载，可稍后重试。";
      el("update").disabled=false;
    }
  };
  void check(true);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void check();});
  window.addEventListener("pageshow",e=>{if(e.persisted)void check();});
  window.addEventListener("online",()=>{void check(true);});
}
