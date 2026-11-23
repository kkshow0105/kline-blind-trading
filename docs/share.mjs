export async function shareScore(score, market, pct, ratio) {
  const canvas=document.createElement("canvas");
  canvas.width=900;canvas.height=1010;
  const ctx=canvas.getContext("2d");
  const text=(value,x,y,size,color,weight=500)=>{
    ctx.font=weight+" "+size+"px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillStyle=color;ctx.fillText(value,x,y);
  };
  ctx.fillStyle="#10151b";ctx.fillRect(0,0,900,1010);
  ctx.fillStyle="#f6c777";ctx.fillRect(58,58,46,6);
  text("K线盲测",58,123,49,"#edf2f7",700);
  text(market.name+" · "+market.symbol,58,193,34,"#d0dce7");
  text(market.start+" — "+market.end,58,242,26,"#aebbc7");
  text("累计净收益率",58,325,30,"#aebbc7");
  text(pct(score.net),52,462,119,score.net>0 ? "#ff7880" : score.net<0 ? "#5ad5a6" : "#edf2f7",750);
  text("已扣除交易成本",58,522,28,"#aebbc7");
  const stats=[["最大回撤",pct(score.drawdown)],["交易笔数",String(score.closed)],
    ["胜率",pct(score.hit,false)],["平均盈亏比",ratio(score.payoff)]];
  stats.forEach(([label,value],i)=>{
    const x=58+(i%2)*401,y=563+Math.floor(i/2)*136;
    ctx.fillStyle="#1c2732";ctx.fillRect(x,y,382,116);
    text(label,x+19,y+36,25,"#aebbc7");
    text(value,x+19,y+87,42,"#edf2f7",650);
  });
  const address=new URL("./",location.href);
  const link=address.protocol==="https:" ? address.href : "历史行情模拟";
  ctx.font="500 24px sans-serif";ctx.fillStyle="#aebbc7";ctx.fillText(link,58,905,784);
  text("人工买卖历史回放",58,950,23,"#aebbc7");
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  if(!blob)throw new Error("无法生成图片");
  const file=new File([blob],"K线盲测成绩-"+market.symbol+".png",{type:"image/png"});
  try {
    if(navigator.share && navigator.canShare?.({files:[file]})){
      await navigator.share({files:[file],title:"K线盲测成绩"});
      return null;
    }
  } catch(error) {if(error.name==="AbortError")return null;}
  return URL.createObjectURL(blob);
}
