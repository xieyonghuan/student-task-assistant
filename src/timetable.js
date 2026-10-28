import { nativeCall } from './native.js';
import { newId } from './domain.js';
import { parseTimetableLayout, dedupeCourses, parseWeeks, formatWeeks, DAYS } from './timetable-parse.js';
import { courseDraft } from './timetable-drafts.js';
import { recognizeImage, cancelOCR } from './ocr.js';
import './timetable.css';

const clone = obj => structuredClone(obj);
const iso = date => new Date(date).toISOString().slice(0, 10);
const plus = (day, days) => iso(Date.parse(`${day}T12:00:00+08:00`) + days * 86400000);
const today = () => iso(Date.now() + 8 * 3600000);
const monday = day => { const date = new Date(`${day}T12:00:00+08:00`); return plus(day, -((date.getUTCDay() + 6) % 7)); };
const courseReady = course => course.day > 0 && course.start > 0 && course.weeks.length > 0;
const initialPeriods = ['08:00-08:45','08:55-09:40','10:00-10:45','10:55-11:40','14:00-14:45','14:55-15:40','16:00-16:45','16:55-17:40','19:00-19:45','19:55-20:40','20:50-21:35','21:45-22:30'];
function periodsFromText(text) {
  const rows = text.trim().split('\n').filter(l=>l.trim());
  if (!rows.length || rows.length > 20) throw new Error('作息需要 1 至 20 节，每行填写一节。');
  let previous = '';
  return rows.map(row => {
    const m = row.trim().match(/^(\d{2}:\d{2})\s*[-—–~至]\s*(\d{2}:\d{2})$/);
    if (!m || [m[1],m[2]].some(time=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || m[1] >= m[2] || m[1] < previous) throw new Error('作息格式应为 08:00-08:45，各节依次递增且不重叠。');
    previous = m[2]; return { start: m[1], end: m[2] };
  });
}
function laneEvents(events) {
  const lanes = []; const result = [];
  for (const event of events) {
    let lane = lanes.findIndex(end=>end < event.start); if (lane < 0) lane = lanes.length;
    lanes[lane] = event.end; result.push({ ...event, lane });
  }
  return result.map(event=>({ ...event, lanes: Math.max(1, lanes.length) }));
}

export function createTimetable({ openDialog, esc, toast }) {
  const element = document.createElement('div'); element.className = 'timetable-root';
  let state, tableId = '', from = monday(today()), events = [], status = {}, busy = false, loadToken = 0;
  let importDialog, importBusy = false, draft, draftWrites = Promise.resolve();
  const $ = (selector, root = element) => root.querySelector(selector);
  const table = () => state?.tables.find(t=>t.id===tableId);
  const run = async action => { try { await action(); } catch (error) { toast(error.message || '课程表操作未完成，请重试。', true); } };
  async function save(next) {
    let saved;
    try { saved = await nativeCall('courseSave', { state: next, revision: state.revision }); }
    catch (error) {
      if (/刚刚发生变化/.test(error.message)) { state = await nativeCall('courseLoad'); await refresh(); }
      throw error;
    }
    state = saved;
    await refresh(); return saved;
  }
  async function refresh() {
    const token = ++loadToken;
    tableId = state.tables.some(t=>t.id===tableId) ? tableId : state.tables[0]?.id || '';
    const [week, permissions] = await Promise.all([tableId ? nativeCall('courseWeek', { tableId, from }) : { occurrences: [] }, nativeCall('courseReminderStatus')]);
    if (token !== loadToken) return;
    events = week.occurrences || []; status = permissions; render();
  }
  async function load() {
    state = await nativeCall('courseLoad');
    if (!Array.isArray(state.tables)) throw new Error('无法读取本机课程表，请更新安装包后重试。');
    try { tableId ||= localStorage.getItem('shike-viewed-course-table') || ''; } catch { /* Native data is authoritative. */ }
    await refresh();
  }
  function reminderText() {
    if (!state.reminders) return '上课提醒未开启';
    const name = state.tables.find(t=>t.id===state.primaryId)?.name || '';
    return `${name} · 提前 ${state.leadMinutes} 分钟 · ${!status.granted ? '通知权限未开启，当前无法提醒' : !status.exact ? '未允许准确提醒，可能延迟' : status.error ? status.error : status.scheduled ? '提醒已安排' : '当前没有待提醒的课程'}`;
  }
  function render() {
    const t = table();
    element.innerHTML = `<div class="course-toolbar glass"><div class="course-switch"><label>当前查看<select id="course-table-select" aria-label="切换课表">${state.tables.map(item=>`<option value="${esc(item.id)}" ${item.id===tableId?'selected':''}>${esc(item.name)}${state.primaryId===item.id?' · 提醒课表':''}</option>`).join('')}</select></label><button class="button button-light" data-course="new-table">新建课表</button>${t?'<button class="button button-light" data-course="manage">管理课表</button>':''}</div><div class="course-actions">${t?'<button class="button button-primary" data-course="ocr">识别课表截图</button><button class="button button-light" data-course="add">添加课程</button>':''}<button class="button button-light" data-course="reminders">上课提醒</button></div></div>
      <div class="course-reminder-summary ${state.reminders && (!status.granted || !status.exact || status.error)?'course-warning':''}" role="status">${esc(reminderText())}</div>
      ${!t ? `<section class="course-empty glass"><span class="course-eyebrow">课程与时间，都安排好</span><h2>建一份自己的课程表</h2><p>先设置第一教学周和作息，再识别截图或手动添加课程。支持多份课表与单次调课。</p><button class="button button-primary" data-course="new-table">创建第一份课表</button></section>` : `
      <div class="course-week-bar"><button class="button button-light" data-course="prev" aria-label="上一周">‹</button><div><strong>${weekLabel(t)}</strong><span>${esc(from)} — ${esc(plus(from,6))}</span></div><button class="button button-light" data-course="next" aria-label="下一周">›</button><button class="text-button" data-course="today">回到本周</button></div>
      <section class="course-grid-scroll glass" aria-label="每周课程表"><div class="course-grid" style="--period-count:${t.periods.length}"><div class="course-time-column"><div class="course-day-heading">节次</div>${t.periods.map((p,i)=>`<div class="course-time"><b>${i+1}</b><small>${esc(p.start)}<br>${esc(p.end)}</small></div>`).join('')}</div>${Array.from({length:7},(_,i)=>{
        const date = plus(from,i), dayEvents = laneEvents(events.filter(e=>e.date===date).sort((a,b)=>a.start-b.start||a.end-b.end));
        return `<div class="course-day ${date===today()?'is-today':''}"><div class="course-day-heading">${DAYS[i+1]}<small>${date.slice(5)}</small></div><div class="course-day-body">${t.periods.map(()=>'<div class="course-slot"></div>').join('')}${dayEvents.map(e=>`<button class="course-block color-${[...e.courseId].reduce((sum,c)=>sum+c.charCodeAt(0),0)%6}" data-course="occurrence" data-key="${esc(e.key)}" style="top:${(e.start-1)*90+3}px;height:${(e.end-e.start+1)*90-6}px;left:calc(${e.lane/e.lanes*100}% + 2px);width:calc(${100/e.lanes}% - 4px)" aria-label="${esc(e.name)} ${date} 第${e.start}至${e.end}节"><strong>${esc(e.name)}</strong>${e.room?`<span>${esc(e.room)}</span>`:''}<small>${e.changed?'已调课 · ':''}${e.start}–${e.end} 节</small>${e.lanes>1?'<small>同日有重叠安排，请核对</small>':''}</button>`).join('')}</div></div>`;
      }).join('')}</div></section>
      <div class="course-list-heading"><h2>全部课程安排 <small>${t.courses.length}</small></h2><p>点课程编辑学期安排；点周课表中的课程调整某一次上课。</p></div>
      <section class="course-arrangements">${t.courses.length?t.courses.map(c=>`<button class="course-row glass" data-course="edit" data-id="${esc(c.id)}"><strong>${esc(c.name)}</strong><span>${courseReady(c)?`${DAYS[c.day]} · 第 ${c.start}–${c.end} 节 · ${formatWeeks(c.weeks)} 周`:'待补全 · 不安排提醒'}</span><small>${esc([c.room,c.teacher].filter(Boolean).join(' · ')) || '编辑课程详情'}</small></button>`).join(''):'<div class="course-empty glass"><h3>这份课表还没有课程</h3><p>可以一次选择多张课程列表或课程表截图，核对后统一保存。</p><button class="button button-primary" data-course="ocr">识别课表截图</button></div>'}</section>
      ${t.changes.length?`<section class="course-changes glass"><h3>调课与停课记录</h3>${t.changes.map((change,i)=>`<div><span>${esc(t.courses.find(c=>c.id===change.courseId)?.name)} · ${esc(change.date)} → ${change.type==='cancel'?'停课':`${esc(change.targetDate)} 第${change.start}–${change.end}节`}</span><button class="text-button" data-course="undo-change" data-index="${i}">撤销</button></div>`).join('')}</section>`:''}`}
      <div class="course-backup-actions"><button class="text-button" data-course="backup">备份课程表</button><label class="text-button">恢复课程表备份<input id="course-restore" type="file" accept="application/json,.json" hidden></label></div>`;
    $('#course-table-select')?.addEventListener('change', event=>run(async()=>{tableId=event.target.value;try{localStorage.setItem('shike-viewed-course-table',tableId);}catch{} await refresh();}));
    $('#course-restore')?.addEventListener('change', event=>run(()=>restoreBackup(event.target.files[0])));
  }
  function weekLabel(t) {
    const diff = Math.floor((Date.parse(from)-Date.parse(t.firstMonday))/604800000)+1;
    return diff < 1 ? '开学前' : diff > t.maxWeeks ? '学期结束后' : `第 ${diff} 周`;
  }
  function tableForm(existing) {
    const t = existing || { name:'我的课表',firstMonday:'',maxWeeks:20,periods:initialPeriods.map(p=>({start:p.slice(0,5),end:p.slice(6)})) };
    const dialog = openDialog(existing?'课表设置':'新建课表','第一教学周日期和作息直接决定课程位置与提醒时间。',`<form id="course-table-form" class="course-form"><label>课表名称<input name="name" required maxlength="80" value="${esc(t.name)}"></label><div class="course-form-row"><label>第一教学周的星期一<input name="firstMonday" type="date" required value="${t.firstMonday}"></label><label>学期周数<input name="maxWeeks" type="number" min="1" max="60" required value="${t.maxWeeks}"></label></div><label>作息时间（每行一节）<textarea name="periods" rows="9" required>${t.periods.map(p=>`${p.start}-${p.end}`).join('\n')}</textarea></label><p class="course-hint">预填作息仅为示例，请按学校实际时间修改。所有课程按北京时间计算。已有调课记录与新设置不兼容时，需要先撤销对应调课。</p><p class="course-form-error" role="alert"></p><button type="submit" class="button button-primary">保存课表</button></form>`);
    $('#course-table-form',dialog).onsubmit = event=>{event.preventDefault();runForm(dialog,async()=>{
      const f = new FormData(event.target), date=String(f.get('firstMonday'));
      if(monday(date)!==date)throw new Error('请选择第一教学周的星期一。');
      const value={...clone(t),name:String(f.get('name')).trim(),firstMonday:date,maxWeeks:+f.get('maxWeeks'),periods:periodsFromText(String(f.get('periods')))};
      const next=clone(state);
      if(existing) next.tables[next.tables.findIndex(x=>x.id===t.id)]=value;
      else {value.id=newId();value.courses=[];value.changes=[];next.tables.push(value);tableId=value.id;from=date;}
      await save(next);dialog.close();toast('课表已保存。');
    });};
  }
  async function runForm(dialog, action) {
    if(busy)return;busy=true;
    const buttons=[...dialog.querySelectorAll('button[type="submit"]')];buttons.forEach(b=>b.disabled=true);
    try{await action();}catch(error){const el=$('.course-form-error',dialog);if(el)el.textContent=error.message;else toast(error.message,true);}
    finally{busy=false;buttons.forEach(b=>b.disabled=false);}
  }
  function courseFields(c, maxWeeks, suffix='') {
    return `<label>课程名称<input name="name${suffix}" maxlength="120" required value="${esc(c.name)}"></label><div class="course-form-row"><label>教师<input name="teacher${suffix}" maxlength="120" value="${esc(c.teacher)}"></label><label>地点<input name="room${suffix}" maxlength="160" value="${esc(c.room)}"></label></div><div class="course-form-row three"><label>星期<select name="day${suffix}">${DAYS.map((d,i)=>`<option value="${i}" ${+c.day===i?'selected':''}>${d}</option>`).join('')}</select></label><label>开始节次<input name="start${suffix}" type="number" min="0" max="20" value="${c.start||0}"></label><label>结束节次<input name="end${suffix}" type="number" min="0" max="20" value="${c.end||0}"></label></div><label>上课周次<input name="weeks${suffix}" placeholder="1-16，或 1-16(单)、2,4,8-12" value="${esc(typeof c.weeks==='string'?c.weeks:formatWeeks(c.weeks))}"></label><small class="course-hint">范围 1–${maxWeeks} 周。星期、节次或周次留空/为 0 时，作为待补全课程保存，不提醒。</small>`;
  }
  function readCourse(form, old={}) {
    return {...old,name:String(form.get('name')||'').trim(),teacher:String(form.get('teacher')||'').trim(),room:String(form.get('room')||'').trim(),day:+form.get('day'),start:+form.get('start'),end:+form.get('end'),weeks:parseWeeks(form.get('weeks'),table().maxWeeks),notes:String(form.get('notes')||old.notes||'').slice(0,2000)};
  }
  function editCourse(id) {
    const t=table(), original=t.courses.find(c=>c.id===id);
    const c=original||{id:newId(),name:'',teacher:'',room:'',day:1,start:1,end:2,weeks:Array.from({length:t.maxWeeks},(_,i)=>i+1),notes:''};
    const dialog=openDialog(original?'编辑课程':'添加课程','此处编辑整学期安排；某一次调课请点击周课表中的课程。',`<form class="course-form" id="course-editor">${courseFields(c,t.maxWeeks)}<label>备注<textarea name="notes" maxlength="2000" rows="3">${esc(c.notes)}</textarea></label><p class="course-form-error" role="alert"></p><div class="course-dialog-actions"><button type="submit" class="button button-primary">保存课程</button>${original?'<button type="button" class="text-button" id="course-delete">删除课程</button>':''}</div></form>`);
    const form=$('#course-editor',dialog);
    form.onsubmit=event=>{event.preventDefault();runForm(dialog,async()=>{
      const value=readCourse(new FormData(form),c);if(!value.name)throw new Error('请填写课程名称。');
      const next=clone(state),target=next.tables.find(t=>t.id===tableId);
      if(original)target.courses[target.courses.findIndex(x=>x.id===id)]=value;else target.courses.push(value);
      await save(next);dialog.close();toast('课程已保存。');
    });};
    $('#course-delete',dialog)?.addEventListener('click',()=>confirmAction('删除这门课程？','该课程的全部上课安排、调课记录与提醒都会移除。',async()=>{
      const next=clone(state),target=next.tables.find(t=>t.id===tableId);target.courses=target.courses.filter(c=>c.id!==id);target.changes=target.changes.filter(c=>c.courseId!==id);await save(next);dialog.close();
    }));
  }
  function confirmAction(title,message,action) {
    const dialog=openDialog(title,'',`<form class="course-form"><p>${esc(message)}</p><p class="course-form-error" role="alert"></p><button type="submit" class="button button-primary">确认</button></form>`);
    $('form',dialog).onsubmit=event=>{event.preventDefault();runForm(dialog,async()=>{await action();dialog.close();});};
  }
  function manage() {
    const t=table();const dialog=openDialog('管理课表',t.name,`<div class="course-manage"><button class="button button-light" id="table-settings">修改名称、学期与作息</button><button class="button button-light" id="table-copy">复制这份课表</button><button class="text-button" id="table-remove">删除这份课表</button></div>`);
    $('#table-settings',dialog).onclick=()=>{dialog.close();tableForm(t);};
    $('#table-copy',dialog).onclick=()=>run(async()=>{
      const copy=clone(t),ids=new Map(copy.courses.map(c=>[c.id,newId()]));copy.id=newId();copy.name=`${copy.name.slice(0,70)} 副本`;
      copy.courses.forEach(c=>c.id=ids.get(c.id));copy.changes.forEach(c=>c.courseId=ids.get(c.courseId));
      const next=clone(state);next.tables.push(copy);tableId=copy.id;await save(next);dialog.close();toast('副本已创建，提醒课表没有改变。');
    });
    $('#table-remove',dialog).onclick=()=>confirmAction('删除整份课表？','这份课表及其调课记录将移除。如果它是提醒课表，上课提醒也会关闭。',async()=>{
      const next=clone(state);next.tables=next.tables.filter(x=>x.id!==t.id);if(next.primaryId===t.id){next.primaryId='';next.reminders=false;}await save(next);dialog.close();
    });
  }
  function changeOccurrence(key) {
    const event=events.find(e=>e.key===key);if(!event)return;
    const t=table();const dialog=openDialog(event.name,`${event.date} · 第 ${event.start}–${event.end} 节 · ${event.room||'未填写地点'}`,`<form class="course-form" id="course-change"><p class="course-hint">仅修改原定 ${esc(event.originalDate)} 的这一次课，不改变其他周，也不向学校提交申请。</p><label>操作<select name="type"><option value="move">调课 / 修改地点</option><option value="cancel">本次停课</option></select></label><div class="course-change-target"><label>调至日期<input name="targetDate" type="date" required value="${event.date}"></label><div class="course-form-row"><label>开始节次<input name="start" type="number" min="1" max="${t.periods.length}" value="${event.start}" required></label><label>结束节次<input name="end" type="number" min="1" max="${t.periods.length}" value="${event.end}" required></label></div><label>地点<input name="room" maxlength="160" value="${esc(event.room)}"></label></div><p class="course-form-error" role="alert"></p><button type="submit" class="button button-primary">保存本次变更</button></form>`);
    const form=$('form',dialog);form.elements.type.onchange=()=>{const cancel=form.elements.type.value==='cancel';$('.course-change-target',dialog).hidden=cancel;$('.course-change-target',dialog).querySelectorAll('input').forEach(i=>i.disabled=cancel);};
    form.onsubmit=e=>{e.preventDefault();runForm(dialog,async()=>{
      const f=new FormData(form),change={courseId:event.courseId,date:event.originalDate,type:f.get('type')};
      if(change.type==='move')Object.assign(change,{targetDate:f.get('targetDate'),start:+f.get('start'),end:+f.get('end'),room:String(f.get('room')).trim()});
      const next=clone(state),target=next.tables.find(t=>t.id===tableId);target.changes=target.changes.filter(c=>!(c.courseId===change.courseId&&c.date===change.date));target.changes.push(change);
      await save(next);dialog.close();toast('本次安排与提醒已更新。');
    });};
  }
  function reminders() {
    const dialog=openDialog('上课提醒','仅所选提醒课表会发通知。切换查看其他课表不会改变它。',`<form class="course-form"><label>提醒课表<select name="primaryId"><option value="">请选择</option>${state.tables.map(t=>`<option value="${esc(t.id)}" ${t.id===state.primaryId?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label class="course-checkbox"><input type="checkbox" name="enabled" ${state.reminders?'checked':''}>开启上课提醒</label><label>提前分钟数<input type="number" name="leadMinutes" min="0" max="120" required value="${state.leadMinutes}"></label><p id="course-permissions" role="status">${status.granted?'通知已允许':'通知未允许'} · ${status.exact?'准确提醒已允许':'准确提醒未允许，可能延迟'}</p><div class="course-dialog-actions"><button class="text-button" type="button" id="course-notify">允许通知 / 通知设置</button><button class="text-button" type="button" id="course-exact">设置准确提醒</button></div><p class="course-hint">声音和振动遵循系统通知设置。请允许拾课在后台运行；系统强行停止、关机或厂商省电限制可能影响提醒。待补全的课程不提醒。</p><p class="course-form-error" role="alert"></p><button type="submit" class="button button-primary">保存提醒设置</button></form>`);
    $('#course-notify',dialog).onclick=()=>run(async()=>{status=await nativeCall('courseNotificationPermission');if(!status.granted)await nativeCall('courseNotificationSettings');$('#course-permissions',dialog).textContent=`${status.granted?'通知已允许':'通知未允许'} · ${status.exact?'准确提醒已允许':'准确提醒未允许'}`;});
    $('#course-exact',dialog).onclick=()=>run(()=>nativeCall('courseExactSettings'));
    $('form',dialog).onsubmit=e=>{e.preventDefault();runForm(dialog,async()=>{
      const f=new FormData(e.target),next=clone(state);next.primaryId=String(f.get('primaryId'));next.reminders=f.has('enabled');next.leadMinutes=+f.get('leadMinutes');
      if(next.reminders&&!next.primaryId)throw new Error('请先选择提醒课表。');
      if(next.reminders&&!status.granted)status=await nativeCall('courseNotificationPermission');
      await save(next);dialog.close();toast(next.reminders&&!status.granted?'设置已保存；需要在系统中允许通知后才能提醒。':'提醒设置已保存。');
    });};
  }
  async function backup() {
    await nativeCall('saveFile',{filename:`拾课课程表-${today()}.json`,type:'application/json',content:JSON.stringify({format:'shike-course-backup',version:1,exportedAt:new Date().toISOString(),state},null,2)});toast('课程表备份已导出。');
  }
  async function restoreBackup(file) {
    if(!file)return;if(file.size>5000000)throw new Error('备份文件超过 5 MB。');
    const data=JSON.parse(await file.text());if(data.format!=='shike-course-backup'||data.version!==1||!Array.isArray(data.state?.tables))throw new Error('请选择拾课课程表备份；作业备份请在首页设置中恢复。');
    confirmAction('恢复课程表备份？',`将替换本机的 ${state.tables.length} 份课表，恢复 ${data.state.tables.length} 份课表。原有作业任务不受影响。提醒默认关闭，请核对后重新开启。`,async()=>{const next=data.state;next.reminders=false;await save(next);});
  }
  async function persistDraft() { const snapshot=clone(draft);draftWrites=draftWrites.catch(()=>{}).then(()=>courseDraft('put',snapshot));return draftWrites; }
  async function openImport() {
    if(importDialog?.open)return;
    draft=await courseDraft('get')||{sources:[],mode:'auto',targetId:tableId};draft.targetId=state.tables.some(t=>t.id===draft.targetId)?draft.targetId:tableId;
    draft.sources.forEach(s=>{if(s.status==='running')s.status='waiting';});
    importDialog=openDialog('识别课程表截图','支持课程列表和周课表。识别完成后核对星期、节次与周次，再统一保存。','<div id="course-import-host"></div>',{wide:true,onClose:()=>{if(importBusy)cancelOCR();importBusy=false;importDialog=null;}});
    renderImport();
  }
  function renderImport() {
    if(!importDialog?.open)return;
    const host=$('#course-import-host',importDialog),total=draft.sources.reduce((n,s)=>n+(s.items?.length||0),0);
    host.innerHTML=`<div class="course-import-options course-form"><label>保存到课表<select id="course-import-target" ${importBusy?'disabled':''}>${state.tables.map(t=>`<option value="${esc(t.id)}" ${t.id===draft.targetId?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>截图类型<select id="course-import-mode" ${importBusy?'disabled':''}><option value="auto" ${draft.mode==='auto'?'selected':''}>自动判断</option><option value="grid" ${draft.mode==='grid'?'selected':''}>周课表（保留星期、节次栏）</option><option value="list" ${draft.mode==='list'?'selected':''}>课程列表 / 选课结果</option></select></label></div>
      <div class="course-dialog-actions"><label class="button button-primary">选择课表截图<input id="course-images" type="file" accept="image/*" multiple hidden ${importBusy?'disabled':''}></label><button class="button button-light" id="course-import-run" ${importBusy?'disabled':''}>${draft.sources.some(s=>s.status!=='done')?'开始 / 继续识别':'重新解析文字'}</button>${importBusy?'<button class="text-button" id="course-import-stop">暂停识别</button>':''}<button class="text-button" id="course-import-clear" ${importBusy?'disabled':''}>清空本次草稿</button></div>
      <p class="course-hint">原图与识别结果只保存在本机草稿中。刷新或退出后可继续；成功保存后自动清理。相同的课程、时间、周次和地点会去重，同一门课的不同上课时段会保留。</p><p id="course-ocr-progress" role="status">${importBusy?'正在识别，请稍候':`已提取 ${total} 个候选安排，核对后保存。`}</p>
      <div class="course-source-list">${draft.sources.map((source,index)=>`<details class="course-source glass" ${source.status!=='done'?'open':''}><summary>${esc(source.name)} · ${source.status==='done'?`${source.items?.length||0} 个候选`:source.status==='error'?'识别未完成':source.status==='running'?'正在识别':'待识别'}</summary>${source.file?`<img class="course-source-preview" data-source-image="${index}" alt="${esc(source.name)}原图">`:''}${source.error?`<p class="course-warning">${esc(source.error)}</p>`:''}<label>识别文字（可修改后重新解析）<textarea rows="5" data-source-text="${index}" ${importBusy?'disabled':''}>${esc(source.text||'')}</textarea></label>${(source.warnings||[]).map(w=>`<p class="course-warning">${esc(w)}</p>`).join('')}${!importBusy?`<button class="text-button" data-source-remove="${index}">移除这张截图</button>`:''}</details>`).join('')}</div>
      <form id="course-import-confirm" class="course-form"><div class="course-candidates">${draft.sources.flatMap((s,si)=>(s.items||[]).map((c,ci)=>`<fieldset data-source="${si}" data-item="${ci}" ${importBusy?'disabled':''}><legend><label class="course-checkbox"><input type="checkbox" name="selected" ${c.selected!==false?'checked':''}>${esc(c.name||'待补充课程')} <small>${esc(s.name)}</small></label></legend>${courseFields(c,state.tables.find(t=>t.id===draft.targetId)?.maxWeeks||60)}${(c.warnings||[]).map(w=>`<p class="course-warning">${esc(w)}</p>`).join('')}</fieldset>`)).join('')}</div><label class="course-checkbox"><input type="checkbox" name="checked" required ${importBusy?'disabled':''}>我已对照原图核对；未补全的课程作为待排课程保存，不提醒</label><p class="course-form-error" role="alert"></p><button type="submit" class="button button-primary" ${importBusy||!total?'disabled':''}>确认并保存课程</button></form>`;
    const urls=[];host.querySelectorAll('[data-source-image]').forEach(img=>{const url=URL.createObjectURL(draft.sources[+img.dataset.sourceImage].file);urls.push(url);img.src=url;img.onload=()=>URL.revokeObjectURL(url);});
    $('#course-import-target',host).onchange=e=>{draft.targetId=e.target.value;run(async()=>{await persistDraft();renderImport();});};
    $('#course-import-mode',host).onchange=e=>{draft.mode=e.target.value;run(persistDraft);};
    $('#course-images',host).onchange=e=>run(async()=>{
      const files=[...e.target.files];if(draft.sources.length+files.length>10)throw new Error('一次最多识别 10 张截图。');
      if(files.some(f=>f.size>20000000))throw new Error('单张截图超过 20 MB，请裁剪后再试。');
      for(const file of files)draft.sources.push({id:newId(),name:file.name,file,status:'waiting',text:'',items:[]});await persistDraft();renderImport();await processImages();
    });
    $('#course-import-run',host).onclick=()=>run(async()=>{
      if(draft.sources.some(s=>s.status!=='done'))await processImages();
      else {for(const source of draft.sources){const parsed=parseTimetableLayout({lines:source.lines||[],text:source.text},source.textEdited?'list':draft.mode);source.items=parsed.items.map(c=>({...c,selected:true}));source.warnings=parsed.warnings;}await persistDraft();renderImport();}
    });
    $('#course-import-stop',host)?.addEventListener('click',()=>{cancelOCR();});
    $('#course-import-clear',host).onclick=()=>confirmAction('清空课程表识别草稿？','将删除本次截图和候选结果，已保存课程不会改变。',async()=>{await courseDraft('delete');draft={sources:[],mode:'auto',targetId:tableId};renderImport();});
    host.querySelectorAll('[data-source-remove]').forEach(button=>button.onclick=()=>run(async()=>{draft.sources.splice(+button.dataset.sourceRemove,1);await persistDraft();renderImport();}));
    host.querySelectorAll('[data-source-text]').forEach(input=>input.oninput=()=>{const s=draft.sources[+input.dataset.sourceText];s.text=input.value;s.textEdited=true;run(persistDraft);});
    host.querySelectorAll('.course-candidates fieldset').forEach(field=>{
      const selected=field.querySelector('[name="selected"]');
      const disableUnselected=()=>field.querySelectorAll('input:not([name="selected"]),select').forEach(input=>input.disabled=!selected.checked);
      disableUnselected();
      field.addEventListener('input',()=>{
        const c=draft.sources[+field.dataset.source].items[+field.dataset.item];for(const name of ['name','teacher','room','day','start','end','weeks'])c[name]=field.querySelector(`[name="${name}"]`).value;c.selected=selected.checked;disableUnselected();run(persistDraft);
      });
    });
    $('#course-import-confirm',host).onsubmit=e=>{e.preventDefault();runForm(importDialog,async()=>{
      const target=state.tables.find(t=>t.id===draft.targetId);if(!target)throw new Error('请选择目标课表。');
      const imported=[];
      for(const source of draft.sources)for(const row of source.items||[]){if(row.selected===false)continue;const c={id:newId(),name:row.name.trim(),teacher:row.teacher.trim(),room:row.room.trim(),day:+row.day,start:+row.start,end:+row.end,weeks:typeof row.weeks==='string'?parseWeeks(row.weeks,target.maxWeeks):row.weeks,notes:row.notes||''};if(!c.name)throw new Error('请补充已选课程的名称。');imported.push(c);}
      if(!imported.length)throw new Error('请至少选择一项课程。');
      const next=clone(state),saved=next.tables.find(t=>t.id===target.id),before=saved.courses.length;saved.courses=dedupeCourses([...saved.courses,...imported]);
      const added=saved.courses.length-before;tableId=target.id;await save(next);await draftWrites;await courseDraft('delete');importDialog.close();toast(`已保存 ${added} 个安排，合并 ${imported.length-added} 个重复项。`);
    });};
  }
  async function processImages() {
    if(importBusy)return;importBusy=true;renderImport();
    try{
      for(const source of draft.sources){
        if(source.status==='done')continue;
        source.status='running';source.error='';await persistDraft();renderImport();
        try{
          const result=await recognizeImage(source.file,(message,progress)=>{const el=importDialog&&$('#course-ocr-progress',importDialog);if(el)el.textContent=`${source.name} · ${message} ${Math.round(progress*100)}%`;},{layout:true});
          const parsed=parseTimetableLayout(result,draft.mode);source.text=result.text;source.lines=result.lines;source.items=parsed.items.map(c=>({...c,selected:true}));source.warnings=parsed.warnings;source.status='done';source.textEdited=false;
          if(!source.items.length)source.warnings.push('没有提取出课程，请修改文字、裁剪截图，或手动录入。');
          await persistDraft();if(!importDialog?.open)break;
        }catch(error){source.status='error';source.error=error.message;await persistDraft();break;}
      }
    }finally{importBusy=false;renderImport();}
  }
  element.addEventListener('click',event=>{
    const b=event.target.closest('[data-course]');if(!b)return;
    run(async()=>{
      switch(b.dataset.course){
        case 'new-table':tableForm();break;case 'manage':manage();break;case 'add':editCourse();break;case 'edit':editCourse(b.dataset.id);break;
        case 'ocr':await openImport();break;case 'reminders':reminders();break;case 'backup':await backup();break;
        case 'prev':from=plus(from,-7);await refresh();break;case 'next':from=plus(from,7);await refresh();break;case 'today':from=monday(today());await refresh();break;
        case 'occurrence':changeOccurrence(b.dataset.key);break;
        case 'undo-change':{const next=clone(state);next.tables.find(t=>t.id===tableId).changes.splice(+b.dataset.index,1);await save(next);toast('已撤销变更。');break;}
      }
    });
  });
  async function openTarget() {
    const target=await nativeCall('courseOpenTarget');if(!target?.tableId)return;
    if(!state)await load();
    tableId=target.tableId;from=monday(target.date||today());location.hash='#/timetable';await refresh();if(target.key)changeOccurrence(target.key);
  }
  window.addEventListener('shike-course-open',()=>run(openTarget));
  window.addEventListener('shike-course-resume',()=>{if(state)run(refresh);});
  return {element,mount(host){host.append(element);if(!state){element.innerHTML='<p role="status">正在读取本机课程表…</p>';run(async()=>{try{await load();await openTarget();}catch(error){element.innerHTML='<p role="alert">课程表未能打开，请返回首页后重试。原有数据未被清空。</p>';throw error;}});}},openTarget:()=>run(openTarget)};
}
