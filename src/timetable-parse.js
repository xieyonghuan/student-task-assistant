// Screenshot parsing produces editable candidates, never saved courses or alarms.
export const DAYS = ['待补充', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const normalize = value => String(value || '').normalize('NFKC').replace(/[—–－~～至]/g, '-').replace(/\r/g, '')
  .replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, '').trim();
export function parseWeeks(value, max = 60) {
  const text = normalize(value).replace(/第/g, '').replace(/星期/g, '').replace(/\s/g, '');
  if (!text) return [];
  const weeks = new Set();
  for (const part of text.split(/[,，、;；]+/)) {
    const clean = part.replace(/周次[:：]?|周|[()（）]/g, '');
    const match = clean.match(/^(\d{1,2})(?:-(\d{1,2}))?([单双])?$/);
    if (!match) throw new Error('周次请填写如 1-16、1-16(单)、2,4,8-12。');
    const start = +match[1], end = +(match[2] || match[1]);
    if (start < 1 || end < start || end > max) throw new Error(`周次应在 1 至 ${max} 周内。`);
    for (let week = start; week <= end; week++) if (!match[3] || week % 2 === (match[3] === '单' ? 1 : 0)) weeks.add(week);
  }
  if (!weeks.size) throw new Error('所填单双周范围内没有上课周次。');
  return [...weeks].sort((a, b) => a - b);
}
export function formatWeeks(weeks) {
  const sorted = [...new Set(weeks || [])].sort((a, b) => a - b); const parts = [];
  for (let i = 0; i < sorted.length; i++) { const first = sorted[i]; let last = first; while (sorted[i + 1] === last + 1) last = sorted[++i]; parts.push(first === last ? `${first}` : `${first}-${last}`); }
  return parts.join(',');
}
export function parseDay(text) {
  const match = normalize(text).replace(/\s/g, '').match(/(?:星期|周)([一二三四五六日天1-7])/);
  return match ? digits[match[1]] || +match[1] : 0;
}
const weekPattern = /(?:周次\s*[:：]?\s*)?((?:第\s*)?\d{1,2}\s*(?:-\s*\d{1,2})?\s*(?:周\s*)?(?:[（(]?[单双][)）]?\s*)?(?:[,，、]\s*\d{1,2}\s*(?:-\s*\d{1,2})?\s*(?:周\s*)?(?:[（(]?[单双][)）]?\s*)?)*周(?:\s*[（(]?[单双][)）]?)?|周次\s*[:：]\s*[^\n;；]+)/;
function candidate(raw) {
  const text = normalize(raw); const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const result = { name: '', teacher: '', room: '', day: parseDay(text), start: 0, end: 0, weeks: [], notes: '', warnings: [] };
  // Never let a room number followed by a weekday on the next line become weeks.
  const weekLine = lines.find(line => /^周次\s*[:：]/.test(line)) || lines.find(line => /\d[^\n]*周/.test(line));
  const weekMatch = weekLine?.match(weekPattern);
  if (weekMatch) try { result.weeks = parseWeeks(weekMatch[1] || weekMatch[0]); } catch { result.warnings.push('周次未能完整读取，请核对。'); }
  const period = text.match(/(?:节次\s*[:：]?\s*)(\d{1,2})(?:\s*[-,，]\s*(\d{1,2}))?\s*节?|(?:\[|【|\()(\d{1,2})\s*-\s*(\d{1,2})(?:节)?(?:\]|】|\))/)
    || text.match(/第\s*(\d{1,2})(?:\s*[-,，]\s*(\d{1,2}))?\s*节/);
  const compactPeriod = text.match(/(?:周|星期)[一二三四五六日天1-7]\s*[,， ]*\s*(\d{1,2})\s*-\s*(\d{1,2})\s*节/);
  const range = period || compactPeriod;
  if (range) { result.start = +(range[1] || range[3]); result.end = +(range[2] || range[4] || range[1]); if (result.start > 20 || result.end > 20 || result.end < result.start) { result.start = result.end = 0; result.warnings.push('节次未能完整读取。'); } }
  result.teacher = text.match(/(?:教师|老师|任课教师)\s*[:：]\s*([^\n;；]+)/)?.[1]?.trim() || '';
  result.room = text.match(/(?:上课地点|地点|教室)\s*[:：]\s*([^\n;；]+)/)?.[1]?.trim() || '';
  const explicit = text.match(/(?:课程名称|课程|科目)\s*[:：]\s*([^\n;；]+)/)?.[1];
  if (explicit) result.name = explicit.trim();
  else {
    const names = [];
    for (const line of lines) {
      if (!names.length && /\S.+(?:周[一二三四五六日天1-7]|星期[一二三四五六日天1-7])/.test(line)) {
        names.push(line.split(/(?:周|星期)[一二三四五六日天1-7]/)[0].replace(/^\s*\d+[.、)]\s*/, '').trim()); break;
      }
      if (/^(?:教师|老师|地点|教室|任课|周次|节次|上课|备注|星期|周[一二三四五六日天1-7])/.test(line) || weekPattern.test(line) || /^第?\s*\d+(?:\s*-\s*\d+)?\s*节/.test(line)) break;
      if (/^(?:课程表|课程列表|学期课表|个人课表|姓名|学号|学期|共\s*\d+|返回|设置)/.test(line)) continue;
      names.push(line.replace(/^\s*\d+[.、)]\s*/, ''));
    }
    result.name = names.join('').slice(0, 120);
  }
  result.notes = text.slice(0, 2000);
  return result;
}
export function dedupeCourses(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = JSON.stringify([item.name.replace(/\s/g, ''), item.teacher.trim(), item.room.trim(), item.day, item.start, item.end, [...(item.weeks || [])].sort((a,b)=>a-b)]);
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}
export function parseCourseList(raw) {
  const text = normalize(raw).replace(/\\n/g, '\n'); const groups = []; let current = [];
  for (const line of text.split('\n')) {
    const value = line.trim();
    const heading = /^(?:课程名称|课程|科目)\s*[:：]|^\d+[.、)]\s*\S/.test(value);
    if (!value || (heading && current.length)) { if (current.length) groups.push(current.join('\n')); current = []; }
    if (value) current.push(value);
  }
  if (current.length) groups.push(current.join('\n'));
  // A plain list of course names remains an unscheduled list, not a fabricated weekly timetable.
  if (groups.length === 1 && !/周次|星期|周[一二三四五六日天1-7]|\d\s*周|节|教师|教室|地点/.test(text))
    return dedupeCourses(text.split('\n').map(line => candidate(line)).filter(item => item.name));
  return dedupeCourses(groups.map(candidate).filter(item => item.name));
}
const center = line => ({ x: (line.bbox.x0 + line.bbox.x1) / 2, y: (line.bbox.y0 + line.bbox.y1) / 2 });
function listColumns(lines) {
  const fields = { '课程名称':'name', '课程':'name', '科目':'name', '任课教师':'teacher', '教师':'teacher', '上课地点':'room', '教室':'room', '地点':'room', '星期':'day', '周次':'weeks', '节次':'period' };
  const headers = lines.filter(l=>fields[l.text.replace(/\s/g,'')]);
  const nameHeader = headers.find(l=>fields[l.text.replace(/\s/g,'')]==='name');
  if (!nameHeader) return null;
  const row = headers.filter(l=>Math.abs(center(l).y-center(nameHeader).y)<24).sort((a,b)=>center(a).x-center(b).x);
  if (row.length<2) return null;
  const columns=row.map((l,i)=>({field:fields[l.text.replace(/\s/g,'')],left:i===0?-Infinity:(center(row[i-1]).x+center(l).x)/2,right:i===row.length-1?Infinity:(center(row[i+1]).x+center(l).x)/2}));
  const nameCol=columns.find(c=>c.field==='name'), headerY=Math.max(...row.map(l=>l.bbox.y1));
  const body=lines.filter(l=>l.bbox.y0>headerY);
  const names=body.filter(l=>center(l).x>=nameCol.left&&center(l).x<nameCol.right).sort((a,b)=>a.bbox.y0-b.bbox.y0);
  const result=[];
  for(let i=0;i<names.length;i++){
    const y=center(names[i]).y, top=i===0?headerY:(center(names[i-1]).y+y)/2, bottom=i===names.length-1?Infinity:(center(names[i+1]).y+y)/2;
    const cells={name:names[i].text};
    for(const col of columns){if(col.field==='name')continue;cells[col.field]=body.filter(l=>center(l).y>=top&&center(l).y<bottom&&center(l).x>=col.left&&center(l).x<col.right).map(l=>l.text).join(' ');}
    const input=[`课程名称：${cells.name}`,cells.teacher?`教师：${cells.teacher}`:'',cells.room?`地点：${cells.room}`:'',cells.day?`周${cells.day.replace(/星期|周/g,'').trim()}`:'',cells.weeks?`周次：${cells.weeks}`:'',cells.period?`节次：${cells.period}`:''].filter(Boolean).join('\n');
    const item=candidate(input);if(item.name)result.push(item);
  }
  return dedupeCourses(result);
}
export function parseTimetableLayout({ lines = [], text = '', table }, mode = 'auto') {
  if(table?.kind==='urp-list')return parseCourseCells(table);
  const usable = lines.filter(l => l.text?.trim() && l.bbox && Object.values(l.bbox).every(Number.isFinite));
  const listed = mode !== 'grid' ? listColumns(usable) : null;
  if (listed) return { items: listed, layout: 'list', warnings: ['已按课程列表的列位置提取，请核对跨行内容。'] };
  if (mode === 'list') return { items: parseCourseList(text), layout: 'list', warnings: [] };
  const headers = usable.filter(l => /^(星期|周)[一二三四五六日天1-7]$/.test(l.text.replace(/\s/g, ''))).map(l => ({ ...center(l), day: parseDay(l.text) }));
  let row = [];
  for (const anchor of headers) {
    const peers = headers.filter(h => Math.abs(h.y - anchor.y) < 24);
    if (new Set(peers.map(p => p.day)).size > new Set(row.map(p => p.day)).size) row = peers;
  }
  const byDay = new Map(row.map(h => [h.day, h])); row = [...byDay.values()].sort((a,b)=>a.day-b.day);
  if (row.length < 5) {
    if (mode === 'grid') return { items: [], layout: 'grid', warnings: ['没有读全星期表头。请裁剪保留星期和节次，或改用课程列表模式。'] };
    return { items: parseCourseList(text), layout: 'list', warnings: ['未找到完整星期表头，已按课程列表提取；请核对上课安排。'] };
  }
  const spacing = (row.at(-1).x - row[0].x) / (row.at(-1).day - row[0].day);
  if (spacing <= 0 || row.some((h,i) => i > 0 && h.x <= row[i-1].x))
    return { items: [], layout: 'grid', warnings: ['星期列位置不明确，请裁剪为一张完整的周课表后重试。'] };
  const xOne = row[0].x - (row[0].day - 1) * spacing, headerY = Math.max(...row.map(r=>r.y));
  const labels = usable.filter(l => center(l).x < xOne - spacing * .5 && center(l).y > headerY + 15)
    .map(l => { const m = normalize(l.text).replace(/\s/g,'').match(/^第?(\d{1,2})(?:-(\d{1,2}))?节?$/); return m && +m[1] <= 20 ? { y: center(l).y, start: +m[1], end: +(m[2] || m[1]) } : null; })
    .filter(Boolean).sort((a,b)=>a.y-b.y);
  const items = [];
  for (let day = 1; day <= 7; day++) {
    const column = usable.filter(l => center(l).y > headerY + 15 && Math.abs(center(l).x - (xOne + (day - 1) * spacing)) < spacing * .49).sort((a,b)=>a.bbox.y0-b.bbox.y0);
    const groups = []; let group = [];
    for (const line of column) {
      const gap = group.length ? line.bbox.y0 - group.at(-1).bbox.y1 : 0;
      const prevText = group.map(g=>g.text).join('\n');
      const metadata = /(?:周次|教师|老师|教室|地点|\d+\s*周)/.test(prevText);
      const lineMeta = /^(?:教师|老师|地点|教室|周次|节次)|\d+\s*周/.test(line.text);
      if (group.length && (gap > Math.max(32, (line.bbox.y1-line.bbox.y0) * 2.5) || (metadata && !lineMeta && gap > 10))) { groups.push(group); group = []; }
      group.push(line);
    }
    if (group.length) groups.push(group);
    for (const block of groups) {
      const item = candidate(block.map(l=>l.text).join('\n')); if (!item.name) continue;
      item.day = day;
      if (!item.start && labels.length >= 2) {
        const y = center(block[0]).y;
        const label = labels.reduce((a,b)=>Math.abs(a.y-y)<Math.abs(b.y-y)?a:b);
        item.start = label.start; item.end = label.end;
        item.warnings.push('星期、节次由表格位置推测，请对照原图核对连堂范围。');
      }
      items.push(item);
    }
  }
  return { items: dedupeCourses(items), layout: 'grid', warnings: labels.length < 2 ? ['节次栏没有读全，请逐项补充；未填写的安排不会提醒。'] : ['表格位置推测需要核对；未标明的周次会留空。'] };
}

export function parseCourseCells(table) {
  const items=[];
  for(const row of table.rows||[]){
    const code=normalize(row.code).replace(/\D/g,'');
    if(/课程[名号]/.test(row.name)&&!code)continue;
    const named=/^\d{6,12}$/.test(code)&&/[\p{Script=Han}A-Za-z]{2}/u.test(row.name||'');
    const name=named?normalize(row.name).replace(/\s/g,''):'';
    const entries=(row.meetings||[]).filter(m=>/\d/.test(m.time));
    if(!entries.length&&named)entries.push({time:'',room:''});
    for(const meeting of entries){
      const raw=normalize(meeting.time).replace(/[|]/g,'/').replace(/\s/g,''),item={name,courseCode:named?code:'',teacher:named?normalize(row.teacher).replace(/[＊*“”"'~`]/g,''):'',room:normalize(meeting.room).replace(/[|]/g,'/'),day:parseDay(raw),start:0,end:0,weeks:[],notes:raw,warnings:[],continuation:!named};
      const week=raw.match(/^([^周]+)周/);
      if(week)try{item.weeks=parseWeeks(week[1]);}catch{item.warnings.push('周次未能完整读取，请核对原图。');}
      const period=raw.match(/(?:星期|周)[一二三四五六日天1-7][/]*(\d{1,2})(?:-(\d{1,2}))?(?:节)?$/);
      if(period&&+period[1]>0&&+(period[2]||period[1])>=+period[1]&&+(period[2]||period[1])<=20){item.start=+period[1];item.end=+(period[2]||period[1]);}
      if(!named)item.warnings.push('截图顶部为续行，需与同一课程的其他截图关联。');
      items.push(item);
    }
  }
  return {items,layout:'list',warnings:[]};
}
const meetingKey=item=>JSON.stringify([item.day,item.start,item.end,[...item.weeks].sort((a,b)=>a-b)]);
const roomKey=room=>normalize(room).replace(/\s/g,'').match(/(?:[A-Za-z]\d{3,4}|\d{3,4})$/)?.[0]||normalize(room).replace(/\s/g,'');
export function reconcileCourseSources(sources) {
  const all=[];
  sources.forEach((source,index)=>{
    const parsed=source.table?parseCourseCells(source.table):parseTimetableLayout({lines:source.lines||[],text:source.text||''},source.textEdited?'list':source.mode||'auto');
    source.warnings=parsed.warnings;source.items=[];
    for(const item of parsed.items)all.push({...item,sourceIndex:index,selected:true});
  });
  const groups=new Map();
  for(const item of all)if(item.name){const key=item.courseCode||item.name.replace(/\s/g,'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  for(const source of sources){
    const orphans=all.filter(item=>item.sourceIndex===sources.indexOf(source)&&!item.name&&item.continuation);
    if(!orphans.length)continue;
    const matches=[...groups.values()].filter(group=>orphans.some(orphan=>orphan.day&&orphan.start&&orphan.weeks.length&&group.some(known=>meetingKey(orphan)===meetingKey(known)&&(!orphan.room||!known.room||roomKey(orphan.room)===roomKey(known.room)))));
    if(matches.length===1){const group=matches[0],name=group[0].name,courseCode=group[0].courseCode;orphans.forEach(item=>{item.name=name;item.courseCode=courseCode;item.continuation=false;item.warnings=[];group.push(item);});}
    else for(const item of orphans){item.name='待关联课程';item.courseCode='unlinked-'+item.sourceIndex;item.selected=false;source.warnings.push('有截图续行无法唯一关联课程，请在确认时补充名称，或与含完整课程名的截图一同识别。');}
  }
  for(const group of groups.values()){
    const named=group.find(item=>item.teacher)||group[0];
    for(const item of group){item.name=group[0].name;item.teacher=named.teacher;}
  }
  const seen=new Set();
  for(const item of all){
    if(!item.name)continue;
    const same=all.filter(other=>other.name===item.name&&(other.courseCode||'')===(item.courseCode||''));
    const full=other=>other.day>0&&other.start>0&&other.weeks.length>0;
    if(!full(item)&&same.some(other=>full(other)&&(!item.day||item.day===other.day)&&(!item.start||item.start===other.start)&&(!item.weeks.length||formatWeeks(item.weeks)===formatWeeks(other.weeks))))continue;
    const key=JSON.stringify([item.courseCode||item.name,meetingKey(item),roomKey(item.room)]);
    if(seen.has(key))continue;seen.add(key);sources[item.sourceIndex].items.push(item);
  }
  return sources;
}
