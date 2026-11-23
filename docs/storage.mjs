let connection;

function open() {
  connection ??= new Promise((resolve,reject)=>{
    const request=indexedDB.open("kline-blind-trading",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("samples");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  return connection;
}

export async function readProgress(key) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const req=db.transaction("samples").objectStore("samples").get(key);
    req.onsuccess=()=>resolve(req.result ?? {rev:0,log:[]});
    req.onerror=()=>reject(req.error);
  });
}

export async function writeProgress(key, expected, log) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("samples","readwrite");
    const store=tx.objectStore("samples");
    const current=store.get(key);
    let next, conflict=false;
    current.onsuccess=()=>{
      const saved=current.result ?? {rev:0,log:[]};
      if (saved.rev!==expected.rev || saved.log.length!==expected.log.length) {
        conflict=true;
        next=saved;
        return;
      }
      next={rev:saved.rev+1,log};
      store.put(next,key);
    };
    tx.oncomplete=()=>resolve({next,conflict});
    tx.onabort=()=>reject(tx.error ?? new Error("保存失败"));
  });
}
