export const DAY_PARTS = [['morning','上午'],['afternoon','下午'],['evening','晚上']];
export function timeMinutes(raw) {
  const m=String(raw).trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
  if(!m||+m[1]>23||+m[2]>59)throw new Error('时间请填写为 08:00 这样的格式。');
  return +m[1]*60 + +m[2];
}
export function minutesTime(value) {
  if(!Number.isInteger(value)||value<0||value>=1440)throw new Error('下课时间超过当天，请调整上课时间或课长。');
  return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
}
export function validatePeriodGroups(groups) {
  const count=DAY_PARTS.reduce((n,[key])=>{const value=groups[key];if(!Number.isInteger(value)||value<0||value>20)throw new Error('各时段节数应为 0 至 20 的整数。');return n+value;},0);
  if(count<1||count>20)throw new Error('上午、下午和晚上的总节数应为 1 至 20 节。');
  return count;
}
export function scheduleSettings(table) {
  let groups=table.periodGroups;
  try{if(validatePeriodGroups(groups)!==table.periods.length)groups=null;}catch{groups=null;}
  if(!groups){groups={morning:0,afternoon:0,evening:0};for(const p of table.periods){const m=timeMinutes(p.start);groups[m<720?'morning':m<1080?'afternoon':'evening']++;}}
  const duration=table.lessonMinutes||timeMinutes(table.periods[0].end)-timeMinutes(table.periods[0].start);
  return {periodGroups:{...groups},lessonMinutes:Math.min(180,Math.max(5,duration))};
}
export function regroupPeriods(periods,oldGroups,newGroups) {
  validatePeriodGroups(newGroups);let from=0;const result=[];
  for(const [key] of DAY_PARTS){const saved=periods.slice(from,from+oldGroups[key]);from+=oldGroups[key];for(let i=0;i<newGroups[key];i++)result.push(saved[i]?{...saved[i]}:{start:'',end:''});}
  return result;
}
export function periodPart(index,groups) {
  let offset=0;for(const [key,label] of DAY_PARTS){if(index<offset+groups[key])return label;offset+=groups[key];}return '';
}
export function remapPeriodRange(start,end,oldGroups,newGroups) {
  if(!start)return {start:0,end:0};
  const mapped=[];
  for(let i=start;i<=end;i++){
    let oldOffset=0,newOffset=0,found=false;
    for(const [key] of DAY_PARTS){
      if(i<=oldOffset+oldGroups[key]){const local=i-oldOffset;if(local>newGroups[key])throw new Error('减少的节次仍有课程或调课使用，请先修改对应安排。');mapped.push(newOffset+local);found=true;break;}
      oldOffset+=oldGroups[key];newOffset+=newGroups[key];
    }
    if(!found)throw new Error('原课程节次超出作息范围。');
  }
  if(mapped.some((n,i)=>i&&n!==mapped[i-1]+1))throw new Error('有连堂课跨越调整后的时段，请先拆分或修改该上课安排。');
  return {start:mapped[0],end:mapped.at(-1)};
}
