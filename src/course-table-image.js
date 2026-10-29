// Geometry, rather than OCR text order, preserves row-spanned course names.
const grey = (data, i) => data[i] > 195 && data[i] < 235 && Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]) < 7;
function runs(values, distance = 4) {
  const groups=[];
  for(const value of values){if(groups.length&&value-groups.at(-1).at(-1)<=distance)groups.at(-1).push(value);else groups.push([value]);}
  return groups.map(group=>Math.round(group.reduce((a,b)=>a+b,0)/group.length));
}
export function detectCourseTable({data,width,height}) {
  const candidates=[];
  for(let x=0;x<width;x++){
    let count=0;
    for(let y=Math.floor(height*.25);y<height*.96;y+=2)if(grey(data,(y*width+x)*4))count++;
    if(count>height*.22)candidates.push(x);
  }
  const xs=runs(candidates);
  // URP list layout has 16 columns. Do not apply this adapter to arbitrary grids.
  if(xs.length!==17 || xs.at(-1)-xs[0]<width*.7)return null;
  let top=-1,bottom=-1;
  for(let y=Math.floor(height*.12);y<height-8;y++){
    let count=0,light=0;
    for(let c=0;c<xs.length;c++)if(grey(data,(y*width+xs[c])*4))count++;
    for(let c=0;c<xs.length-1;c++){const i=(y*width+Math.round((xs[c]+xs[c+1])/2))*4;if(data[i]>235&&data[i+1]>235&&data[i+2]>235)light++;}
    if(count>=xs.length*.8 && light>=8){if(top<0)top=y;bottom=y;}
  }
  if(top<0||bottom-top<height*.25)return null;
  const linesInColumn = column => {
    const ys=[],left=xs[column]+5,right=xs[column+1]-5;
    for(let y=top;y<=bottom;y++){
      let count=0,total=0;
      for(let x=left;x<right;x+=2){total++;if(grey(data,(y*width+x)*4))count++;}
      if(count>total*.8)ys.push(y);
    }
    return runs(ys,3);
  };
  const boundaries=column=>runs([top,...linesInColumn(column),bottom],8);
  const main=boundaries(0),time=boundaries(14),cells=[],rows=[];
  const add=(column,y0,y1,kind,row,meeting=-1)=>{
    if(y1-y0<16)return null;
    const id=cells.length;cells.push({id,kind,row,meeting,x0:xs[column]+5,x1:xs[column+1]-5,y0:y0+5,y1:y1-5});return id;
  };
  for(let r=0;r<main.length-1;r++){
    const y0=main[r],y1=main[r+1];if(y1-y0<25)continue;
    const index=rows.length;
    const row={code:add(0,y0,y1,'code',index),name:add(1,y0,y1,'name',index),teacher:add(9,y0,y1,'teacher',index),meetings:[],edgeTop:y0<=top+8,edgeBottom:y1>=bottom-8};
    const cuts=runs([y0,...time.filter(y=>y>y0+10&&y<y1-10),y1],8);
    for(let m=0;m<cuts.length-1;m++)row.meetings.push({time:add(14,cuts[m],cuts[m+1],'time',index,m),room:add(15,cuts[m],cuts[m+1],'room',index,m)});
    rows.push(row);
  }
  return {kind:'urp-list',rows,cells,width,height};
}
function cellCanvas(source,rect) {
  const crop=document.createElement('canvas');crop.width=rect.x1-rect.x0;crop.height=rect.y1-rect.y0;
  const ctx=crop.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,rect.x0,rect.y0,crop.width,crop.height,0,0,crop.width,crop.height);
  const pixels=ctx.getImageData(0,0,crop.width,crop.height),d=pixels.data;
  let edge=0,count=0;
  for(let y=5;y<crop.height;y+=19){for(const x of [2,Math.max(2,crop.width-3)]){const i=(y*crop.width+x)*4;edge+=(d[i]+d[i+1]+d[i+2])/3;count++;}}
  const invert=count&&edge/count<205,ink=new Uint32Array(crop.height),threshold=invert?Math.max(30,(255-edge/count)*.6):200;
  for(let i=0;i<d.length;i+=4){let value=d[i]*.299+d[i+1]*.587+d[i+2]*.114;if(invert)value=255-value;value=value>threshold?255:0;d[i]=d[i+1]=d[i+2]=value;if(value<175)ink[Math.floor(i/4/crop.width)]++;}
  ctx.putImageData(pixels,0,0);
  const bands=[];
  for(let y=0;y<ink.length;y++)if(ink[y]>=2){if(bands.length&&y-bands.at(-1).end<=4)bands.at(-1).end=y+1;else bands.push({start:y,end:y+1});}
  if(!bands.length){crop.width=crop.height=1;return null;}
  // Reflow wrapped cell lines into one reading line before OCR. A narrow table
  // column must not be interpreted as vertical Chinese text or isolated digits.
  const pieces=bands.map(b=>{
    let left=crop.width,right=0;
    for(let y=b.start;y<b.end;y++)for(let x=0;x<crop.width;x++)if(d[(y*crop.width+x)*4]<175){left=Math.min(left,x);right=Math.max(right,x+1);}
    return {start:Math.max(0,b.start-2),end:Math.min(crop.height,b.end+2),left:Math.max(0,left-2),right:Math.min(crop.width,right+2)};
  }).filter(p=>p.right>p.left&&p.end-p.start>=5);
  if(rect.kind==='name'||rect.kind==='time'){
    const block=document.createElement('canvas');block.width=crop.width;block.height=pieces.reduce((n,p)=>n+p.end-p.start+12,12);
    const out=block.getContext('2d');out.fillStyle='#fff';out.fillRect(0,0,block.width,block.height);let y=6;
    for(const p of pieces){out.drawImage(crop,0,p.start,crop.width,p.end-p.start,0,y,crop.width,p.end-p.start);y+=p.end-p.start+12;}
    crop.width=crop.height=1;return block;
  }
  const compact=document.createElement('canvas');compact.width=pieces.reduce((n,p)=>n+p.right-p.left+5,20);compact.height=Math.max(1,...pieces.map(p=>p.end-p.start))+20;
  const out=compact.getContext('2d');out.fillStyle='#fff';out.fillRect(0,0,compact.width,compact.height);let x=10;
  for(const p of pieces){out.drawImage(crop,p.left,p.start,p.right-p.left,p.end-p.start,x,10,p.right-p.left,p.end-p.start);x+=p.right-p.left+5;}
  crop.width=crop.height=1;return compact;
}
export function courseTableAtlas(canvas) {
  const geometry=detectCourseTable(canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height));
  if(!geometry)return null;
  const packed=[],heights=[0,0],slot=1000,padding=30;
  for(const cell of geometry.cells){
    const crop=cellCanvas(canvas,cell);if(!crop)continue;
    const scale=Math.min(1.7,(slot-padding*2)/crop.width),column=heights.indexOf(Math.min(...heights));
    const width=Math.round(crop.width*scale),height=Math.round(crop.height*scale);
    packed.push({cell:cell.id,kind:cell.kind,crop,x:column*slot+padding,y:heights[column]+padding,width,height});heights[column]+=height+padding*2;
  }
  const atlas=document.createElement('canvas');atlas.width=slot*heights.length;atlas.height=Math.max(1,...heights);
  const ctx=atlas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,atlas.width,atlas.height);
  for(const entry of packed){ctx.drawImage(entry.crop,entry.x,entry.y,entry.width,entry.height);entry.crop.width=entry.crop.height=1;delete entry.crop;}
  return {canvas:atlas,geometry,packed};
}
export function unpackCourseTable(atlas,blocks=[],texts=new Map()) {
  const words=blocks.flatMap(b=>b.paragraphs.flatMap(p=>p.lines)).flatMap(l=>l.words||[]);
  for(const entry of atlas.packed){
    if(texts.has(entry.cell))continue;
    const found=words.filter(w=>{const x=(w.bbox.x0+w.bbox.x1)/2,y=(w.bbox.y0+w.bbox.y1)/2;return x>=entry.x&&x<=entry.x+entry.width&&y>=entry.y&&y<=entry.y+entry.height;});
    found.sort((a,b)=>Math.abs(a.bbox.y0-b.bbox.y0)>Math.min(a.bbox.y1-a.bbox.y0,b.bbox.y1-b.bbox.y0)*.5?a.bbox.y0-b.bbox.y0:a.bbox.x0-b.bbox.x0);
    texts.set(entry.cell,found.map(w=>w.text).join(''));
  }
  return {kind:'urp-list',rows:atlas.geometry.rows.map(row=>({code:texts.get(row.code)||'',name:texts.get(row.name)||'',teacher:texts.get(row.teacher)||'',edgeTop:row.edgeTop,edgeBottom:row.edgeBottom,meetings:row.meetings.map(m=>({time:texts.get(m.time)||'',room:texts.get(m.room)||''}))}))};
}
