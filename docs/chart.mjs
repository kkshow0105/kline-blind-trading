const colors={up:"#ff727b",down:"#53d3a4",ma:["#f4c573","#7ed3e8","#c4a1ed"]};

export function createChart(canvas, select) {
  const ctx=canvas.getContext("2d");
  let bars=[], markers=[], chosen=0, left=0, span=42, width=0, height=0, margin=49;
  let gesture=null;
  const pointers=new Map();
  const plot=()=>width-margin-8;
  const maxSpan=()=>bars.length;
  const bound=()=>{
    span=Math.max(Math.min(6,maxSpan()),Math.min(maxSpan(),span));
    left=Math.max(0,Math.min(maxSpan()-span,left));
  };
  const at=x=>left+(x-8)/plot()*span;
  const x=i=>8+(i-left+.5)/span*plot();
  function show(index) {
    chosen=Math.max(0,Math.min(bars.length-1,index));
    select(bars[chosen]);
    draw();
  }
  function draw() {
    if (!width || !height || !bars.length) return;
    const a=Math.max(0,Math.floor(left)), b=Math.min(bars.length,Math.ceil(left+span));
    const shown=bars.slice(a,b);
    const mainTop=13, mainBottom=height*.73, volumeTop=height*.78, volumeBottom=height-25;
    const prices=shown.flatMap(k=>[k.l,k.h,...k.ma.filter(p=>p!==null)]);
    const min=Math.min(...prices), max=Math.max(...prices), padding=Math.max(.002,(max-min)*.08);
    const floor=min-padding, top=max+padding;
    const y=value=>mainBottom-(value-floor)/(top-floor)*(mainBottom-mainTop);
    const maxVol=Math.max(1,...shown.map(k=>k.vol));
    const end=width-margin;
    ctx.clearRect(0,0,width,height);
    ctx.font="11px ui-monospace,Consolas,monospace";
    ctx.textBaseline="middle";
    for (let i=0;i<=5;i++) {
      const value=floor+(top-floor)*i/5;
      const py=y(value);
      ctx.strokeStyle="#2a333c";
      ctx.beginPath();ctx.moveTo(8,py);ctx.lineTo(end,py);ctx.stroke();
      ctx.fillStyle="#bdc8d3";ctx.fillText(value.toFixed(3),end+5,py);
    }
    ctx.strokeStyle="#36414c";
    ctx.beginPath();ctx.moveTo(8,volumeTop-5);ctx.lineTo(end,volumeTop-5);ctx.stroke();
    ctx.fillStyle="#aebdcb";
    ctx.fillText(maxVol>=1e6 ? (maxVol/1e6).toFixed(0)+"M" : (maxVol/1e3).toFixed(0)+"K",end+5,volumeTop+3);
    ctx.save();
    ctx.beginPath();ctx.rect(8,0,plot(),volumeBottom+1);ctx.clip();
    const body=Math.max(1,Math.min(16,plot()/span*.66));
    shown.forEach((k,j)=>{
      const xi=x(a+j), color=k.c>=k.o ? colors.up : colors.down;
      ctx.strokeStyle=color;ctx.fillStyle=color;
      ctx.beginPath();ctx.moveTo(xi,y(k.h));ctx.lineTo(xi,y(k.l));ctx.stroke();
      ctx.fillRect(xi-body/2,Math.min(y(k.o),y(k.c)),body,Math.max(1,Math.abs(y(k.o)-y(k.c))));
      const v=k.vol/maxVol*(volumeBottom-volumeTop);
      ctx.globalAlpha=.67;ctx.fillRect(xi-body/2,volumeBottom-v,body,v);ctx.globalAlpha=1;
    });
    colors.ma.forEach((color,j)=>{
      ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.beginPath();let started=false;
      shown.forEach((k,i)=>{
        if(k.ma[j]===null)return;
        if(started)ctx.lineTo(x(a+i),y(k.ma[j]));else ctx.moveTo(x(a+i),y(k.ma[j]));
        started=true;
      });
      ctx.stroke();
    });
    if(chosen>=a && chosen<b){
      ctx.strokeStyle="#9aaab8";ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();
      ctx.moveTo(x(chosen),mainTop);ctx.lineTo(x(chosen),volumeBottom);ctx.stroke();ctx.setLineDash([]);
    }
    for (const m of markers) {
      if(m.i<a || m.i>=b)continue;
      const xi=x(m.i), py=y(m.price)+(m.buy ? -8 : 8), d=m.buy ? 1 : -1;
      ctx.fillStyle=m.g1 ? "#8cdaf3" : "#f9c972";
      ctx.beginPath();ctx.moveTo(xi,py-5*d);ctx.lineTo(xi-5,py+4*d);
      ctx.lineTo(xi+5,py+4*d);ctx.closePath();ctx.fill();
    }
    ctx.restore();
    const count=Math.max(2,Math.floor(plot()/71));
    for(let i=0;i<count;i++){
      const index=Math.round(a+(b-a-1)*i/(count-1));
      if(i && index===Math.round(a+(b-a-1)*(i-1)/(count-1))) continue;
      const label=bars[index].date.slice(5);
      ctx.fillStyle="#adb8c4";ctx.fillText(label,Math.max(8,Math.min(end-34,x(index)-16)),height-12);
    }
  }
  function windowAround(index) {
    left=index===bars.length-1 ? bars.length-span : index-span/2;
    bound();draw();
  }
  function zoom(factor, pixel=width*.48) {
    const center=at(pixel), proportion=(pixel-8)/plot();
    span*=factor; bound();
    left=center-proportion*span;bound();draw();
  }
  new ResizeObserver(()=>{
    const box=canvas.getBoundingClientRect(), dpr=Math.min(3,devicePixelRatio||1);
    width=box.width;height=box.height;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);draw();
  }).observe(canvas);
  const local=e=>e.clientX-canvas.getBoundingClientRect().left;
  canvas.addEventListener("pointerdown",e=>{
    if(!bars.length || (e.pointerType==="mouse" && e.button!==0))return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId,{x:local(e),y:e.clientY});
    if(pointers.size===1)gesture={start:local(e),last:local(e),moved:false};
    if(pointers.size===2){
      const [p,q]=pointers.values();
      gesture={moved:true,distance:Math.max(10,Math.hypot(p.x-q.x,p.y-q.y)),mid:(p.x+q.x)/2};
    }
  });
  canvas.addEventListener("pointermove",e=>{
    if(!pointers.has(e.pointerId) || !gesture)return;
    pointers.set(e.pointerId,{x:local(e),y:e.clientY});
    if(pointers.size===2){
      const [p,q]=pointers.values();
      const distance=Math.max(10,Math.hypot(p.x-q.x,p.y-q.y)), mid=(p.x+q.x)/2;
      const anchor=at(gesture.mid);
      span*=gesture.distance/distance;bound();
      left=anchor-(mid-8)/plot()*span;bound();draw();Object.assign(gesture,{distance,mid});
    } else if(pointers.size===1){
      const pixel=local(e);
      if(Math.abs(pixel-gesture.start)>4 || gesture.moved){
        left-=(pixel-gesture.last)*span/plot();bound();draw();gesture.moved=true;gesture.last=pixel;
      }
    }
  });
  function release(e, cancelled) {
    if(!pointers.delete(e.pointerId))return;
    if(pointers.size===1){
      const p=pointers.values().next().value;
      gesture={start:p.x,last:p.x,moved:true};
    } else if(!pointers.size){
      if(!cancelled && gesture && !gesture.moved)show(Math.floor(at(local(e))));
      gesture=null;
    }
  }
  canvas.addEventListener("pointerup",e=>release(e,false));
  canvas.addEventListener("pointercancel",e=>release(e,true));
  canvas.addEventListener("wheel",e=>{
    if(!bars.length)return;
    e.preventDefault();zoom(e.deltaY>0 ? 1.15 : .87,local(e));
  },{passive:false});
  return {
    render(next,nextMarkers=[]){bars=next;markers=nextMarkers;span=Math.min(bars.length,span||42);bindLatest();},
    latest(){bindLatest();},
    zoom,
    focus(i){show(i);windowAround(i);},
    reset(){span=42;bindLatest();},
    all(){span=maxSpan();left=0;draw();},
  };
  function bindLatest(){show(bars.length-1);windowAround(bars.length-1);}
}
