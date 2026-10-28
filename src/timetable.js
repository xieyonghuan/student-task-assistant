import { nativeCall } from './native.js';
import { newId } from './domain.js';
import { parseTimetableLayout, dedupeCourses, parseWeeks, formatWeeks, DAYS } from './timetable-parse.js';
import './timetable.css';
import {tableWizardHTML,bindTableWizard} from './course-periods.js';
import {openCourseImport} from './course-import.js';
import {scheduleSettings,remapPeriodRange} from './course-schedule.js';

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
  let courseImport, openingCourseImport=false;
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
    try { localStorage.setItem('shike-viewed-course-table',tableId); } catch { /* Viewing preferences do not affect native course data. */ }
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
    element.innerHTML = `<div class="course-toolbar glass"><div class="course-switch"><label>当前查看<select id="course-table-select" aria-label="切换课表">${state.tables.map(item=>`<option value="${esc(item.id)}" ${item.id===tableId?'selected':''}>${esc(item.name)}${state.primaryId===item.id?' · 提醒课表':''}</option>`).join('')}</select></label><button class="button button-light" data-course="new-table">新建课表</button>${t?'<button class="button button-light" data-course="manage">管理课表</button>':''}</div><div class="course-actions">${t?'<button class="button button-primary" data-course="ocr">识别课表截图</button><button class="button button-light" data-course="add">添加课程</button><button class="button button-light" data-course="manage-courses">管理课程</button>':''}<button class="button button-light" data-course="reminders">上课提醒</button></div></div>
      <div class="course-reminder-summary ${state.reminders && (!status.granted || !status.exact || status.error)?'course-warning':''}" role="status">${esc(reminderText())}</div>
      ${!t ? `<section class="course-empty glass"><span class="course-eyebrow">课程与时间，都安排好</span><h2>建一份自己的课程表</h2><p>先设置第一教学周和作息，再识别截图或手动添加课程。支持多份课表与单次调课。</p><button class="button button-primary" data-course="new-table">创建第一份课表</button></section>` : `
      <div class="course-week-bar"><button class="button button-light" data-course="prev" aria-label="上一周">‹</button><div><strong>${weekLabel(t)}</strong><span>${esc(from)} — ${esc(plus(from,6))}</span></div><button class="button button-light" data-course="next" aria-label="下一周">›</button><button class="text-button" data-course="today">回到本周</button></div>
      <section class="course-grid-scroll glass" aria-label="每周课程表"><div class="course-grid" style="--period-count:${t.periods.length}"><div class="course-time-column"><div class="course-day-heading">节次</div>${t.periods.map((p,i)=>`<div class="course-time"><b>${i+1}</b><small>${esc(p.start)}<br>${esc(p.end)}</small></div>`).join('')}</div>${Array.from({length:7},(_,i)=>{
        const date = plus(from,i), dayEvents = laneEvents(events.filter(e=>e.date===date).sort((a,b)=>a.start-b.start||a.end-b.end));
        return `<div class="course-day ${date===today()?'is-today':''}"><div class="course-day-heading">${DAYS[i+1]}<small>${date.slice(5)}</small></div><div class="course-day-body">${t.periods.map(()=>'<div class="course-slot"></div>').join('')}${dayEvents.map(e=>`<button class="course-block color-${[...e.courseId].reduce((sum,c)=>sum+c.charCodeAt(0),0)%6}" data-course="occurrence" data-key="${esc(e.key)}" style="top:calc(var(--course-slot-height) * ${e.start-1} + 3px);height:calc(var(--course-slot-height) * ${e.end-e.start+1} - 6px);left:calc(${e.lane/e.lanes*100}% + 2px);width:calc(${100/e.lanes}% - 4px)" aria-label="${esc(e.name)} ${date} 第${e.start}至${e.end}节"><strong>${esc(e.name)}</strong>${e.room?`<span>${esc(e.room.split('/').filter(Boolean).at(-1))}</span>`:''}<small>${e.changed?'已调课 · ':''}${e.start}–${e.end} 节</small>${e.lanes>1?'<small>时间重叠</small>':''}</button>`).join('')}</div></div>`;
      }).join('')}</div></section>
      <details class="course-all"><summary>查看全部课程与待补全安排 · ${t.courses.length} 项</summary><div class="course-list-heading"><h2>全部课程安排 <small>${t.courses.length}</small></h2><p>点课程编辑学期安排；点周课表中的课程调整某一次上课。</p></div>
      <section class="course-arrangements">${t.courses.length?t.courses.map(c=>`<button class="course-row glass" data-course="edit" data-id="${esc(c.id)}"><strong>${esc(c.name)}</strong><span>${courseReady(c)?`${DAYS[c.day]} · 第 ${c.start}–${c.end} 节 · ${formatWeeks(c.weeks)} 周`:'待补全 · 不安排提醒'}</span><small>${esc([c.room,c.teacher].filter(Boolean).join(' · ')) || '编辑课程详情'}</small></button>`).join(''):'<div class="course-empty glass"><h3>这份课表还没有课程</h3><p>可以一次选择多张课程列表或课程表截图，核对后统一保存。</p><button class="button button-primary" data-course="ocr">识别课表截图</button></div>'}</section>
      ${t.changes.length?`<section class="course-changes glass"><h3>调课与停课记录</h3>${t.changes.map((change,i)=>`<div><span>${esc(t.courses.find(c=>c.id===change.courseId)?.name)} · ${esc(change.date)} → ${change.type==='cancel'?'停课':`${esc(change.targetDate)} 第${change.start}–${change.end}节`}</span><button class="text-button" data-course="undo-change" data-index="${i}">撤销</button></div>`).join('')}</section>`:''}`}
      </details><div class="course-backup-actions"><button class="text-button" data-course="backup">备份课程表</button><label class="text-button">恢复课程表备份<input id="course-restore" type="file" accept="application/json,.json" hidden></label></div>`;
    $('#course-table-select')?.addEventListener('change', event=>run(async()=>{tableId=event.target.value;try{localStorage.setItem('shike-viewed-course-table',tableId);}catch{} await refresh();}));
    $('#course-restore')?.addEventListener('change', event=>run(()=>restoreBackup(event.target.files[0])));
  }
  function weekLabel(t) {
    const diff = Math.floor((Date.parse(from)-Date.parse(t.firstMonday))/604800000)+1;
    return diff < 1 ? '开学前' : diff > t.maxWeeks ? '学期结束后' : `第 ${diff} 周`;
  }
  function tableForm(existing) {
    const t = existing || { name:'我的课表',firstMonday:'',maxWeeks:20,periods:initialPeriods.map(p=>({start:p.slice(0,5),end:p.slice(6)})) };
    const dialog = openDialog(existing?'课表设置':'新建课表','基本信息 → 每节作息',tableWizardHTML(t));
    dialog.classList.add('native-flow-screen','period-wizard');
    const wizard=bindTableWizard(dialog,t,nativeCall);
    $('#course-table-form',dialog).onsubmit = event=>{event.preventDefault();runForm(dialog,async()=>{
      if(!wizard.advance())return;
      const fields=wizard.value(),date=fields.firstMonday;
      if(monday(date)!==date)throw new Error('请选择第一教学周的星期一。');
      const value={...clone(t),...fields};
      if(existing){const oldGroups=scheduleSettings(t).periodGroups;for(const c of value.courses)Object.assign(c,remapPeriodRange(c.start,c.end,oldGroups,fields.periodGroups));for(const c of value.changes)if(c.type==='move')Object.assign(c,remapPeriodRange(c.start,c.end,oldGroups,fields.periodGroups));}
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
    return {...old,name:String(form.get('name')||'').trim(),teacher:String(form.get('teacher')||'').trim(),room:String(form.get('room')||'').trim(),day:+form.get('day'),start:+form.get('start'),end:+form.get('end'),weeks:parseWeeks(form.get('weeks'),table().maxWeeks),notes:String(form.has('notes')?form.get('notes'):old.notes||'').slice(0,2000)};
  }
  const coursePeers=(t,c)=>t.courses.filter(x=>x.name===c.name&&(x.teacher||'')===(c.teacher||''));
  function removeCourse(id,after=()=>{}) {
    const t=table(),c=t.courses.find(c=>c.id===id);if(!c)return;const peers=coursePeers(t,c);
    const dialog=openDialog('删除课程安排？',c.name,`<form class="course-form"><label>删除范围<select name="scope"><option value="one">仅这一条上课安排</option>${peers.length>1?`<option value="all">这门课程的全部 ${peers.length} 条安排</option>`:''}</select></label><p>所选安排及其调课记录、上课提醒会一并移除。其他课程不受影响。</p><p class="course-form-error" role="alert"></p><div class="course-dialog-actions"><button type="button" class="button button-light" id="keep-course">保留课程</button><button type="submit" class="button button-danger">确认删除</button></div></form>`);
    $('#keep-course',dialog).onclick=()=>dialog.close();$('form',dialog).onsubmit=event=>{event.preventDefault();runForm(dialog,async()=>{
      const ids=new Set(($('select',dialog).value==='all'?peers:[c]).map(c=>c.id)),next=clone(state),target=next.tables.find(t=>t.id===tableId);
      target.courses=target.courses.filter(c=>!ids.has(c.id));target.changes=target.changes.filter(c=>!ids.has(c.courseId));await save(next);dialog.close();after();toast(`已删除 ${ids.size} 条上课安排，提醒已更新。`);
    });};
  }
  function manageCourses() {
    const t=table();if(!t.courses.length){editCourse();return;}
    const dialog=openDialog('管理课程','选择上课安排后可修改课程，或删除一条 / 整门课的全部安排。',`<form class="course-form"><label>课程与上课安排<select name="courseId">${t.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${DAYS[c.day]} · ${c.start?`第${c.start}—${c.end}节`:'待补全'} · ${formatWeeks(c.weeks)}周</option>`).join('')}</select></label><button class="button button-primary" type="submit">打开编辑与删除</button></form>`);
    $('form',dialog).onsubmit=e=>{e.preventDefault();const id=$('select',dialog).value;dialog.close();editCourse(id);};
  }
  function editCourse(id) {
    const t=table(), original=t.courses.find(c=>c.id===id);
    const c=original||{id:newId(),name:'',teacher:'',room:'',day:1,start:1,end:Math.min(2,t.periods.length),weeks:Array.from({length:t.maxWeeks},(_,i)=>i+1),notes:''};
    const peers=original?coursePeers(t,c):[];
    const dialog=openDialog(original?'编辑课程':'添加课程','修改学期重复安排；仅调整一次上课请使用周课表中的调课功能。',`<form class="course-form" id="course-editor"><div class="course-flow-scroll">${peers.length>1?`<label>本课程上课安排<select id="edit-course-meeting">${peers.map(x=>`<option value="${esc(x.id)}" ${x.id===id?'selected':''}>${DAYS[x.day]} · 第${x.start}—${x.end}节 · ${formatWeeks(x.weeks)}周 · ${esc(x.room)}</option>`).join('')}</select></label>`:''}${courseFields(c,t.maxWeeks)}${peers.length>1?`<label class="course-checkbox"><input type="checkbox" name="syncIdentity" checked>名称和教师同步到本课程全部 ${peers.length} 条安排</label>`:''}<label>备注<textarea name="notes" maxlength="2000" rows="2">${esc(c.notes)}</textarea></label><p class="course-form-error" role="alert"></p></div><div class="course-flow-footer"><button type="submit" class="button button-primary">保存课程</button>${original?'<button type="button" class="text-button" id="course-delete">删除课程</button>':''}</div></form>`);
    dialog.classList.add('native-flow-screen','course-edit-screen');
    const form=$('#course-editor',dialog);let dirty=false;form.addEventListener('input',e=>{if(e.target.id!=='edit-course-meeting')dirty=true;});
    $('#edit-course-meeting',dialog)?.addEventListener('change',e=>{const nextId=e.target.value;if(dirty){e.target.value=id;$('.course-form-error',dialog).textContent='请先保存当前修改，再切换上课安排。';return;}dialog.close();editCourse(nextId);});
    form.onsubmit=event=>{event.preventDefault();runForm(dialog,async()=>{
      const value=readCourse(new FormData(form),c);if(!value.name)throw new Error('请填写课程名称。');
      const next=clone(state),target=next.tables.find(t=>t.id===tableId);
      if(original){target.courses[target.courses.findIndex(x=>x.id===id)]=value;if(form.elements.syncIdentity?.checked){const ids=new Set(peers.map(c=>c.id));target.courses.forEach(c=>{if(ids.has(c.id)){c.name=value.name;c.teacher=value.teacher;}});}}else target.courses.push(value);
      await save(next);dialog.close();toast('课程已保存。');
    });};
    $('#course-delete',dialog)?.addEventListener('click',()=>removeCourse(id,()=>dialog.close()));
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
    const t=table();const dialog=openDialog(event.name,`${event.date} · 第 ${event.start}–${event.end} 节 · ${event.room||'未填写地点'}`,`<form class="course-form" id="course-change"><div class="course-occurrence-tools"><button type="button" class="button button-light" id="occurrence-edit">修改课程</button><button type="button" class="text-button" id="occurrence-delete">删除课程</button></div><p class="course-hint">仅修改原定 ${esc(event.originalDate)} 的这一次课，不改变其他周，也不向学校提交申请。</p><label>操作<select name="type"><option value="move">调课 / 修改地点</option><option value="cancel">本次停课</option></select></label><div class="course-change-target"><label>调至日期<input name="targetDate" type="date" required value="${event.date}"></label><div class="course-form-row"><label>开始节次<input name="start" type="number" min="1" max="${t.periods.length}" value="${event.start}" required></label><label>结束节次<input name="end" type="number" min="1" max="${t.periods.length}" value="${event.end}" required></label></div><label>地点<input name="room" maxlength="160" value="${esc(event.room)}"></label></div><p class="course-form-error" role="alert"></p><button type="submit" class="button button-primary">保存本次变更</button></form>`);
    $('#occurrence-edit',dialog).onclick=()=>{dialog.close();editCourse(event.courseId);};
    $('#occurrence-delete',dialog).onclick=()=>removeCourse(event.courseId,()=>dialog.close());
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
  async function openImport() {
    if(openingCourseImport||courseImport?.dialog.open)return;openingCourseImport=true;
    try{await courseImport?.settled();courseImport=await openCourseImport({tables:state.tables,targetId:tableId,openDialog,esc,courseFields,toast,commit:async(imported,targetId)=>{
      const next=clone(state),target=next.tables.find(t=>t.id===targetId);if(!target)throw new Error('目标课表不存在，请重新打开。');
      const before=target.courses.length;target.courses=dedupeCourses([...target.courses,...imported.map(c=>({id:newId(),name:c.name,teacher:c.teacher,room:c.room,day:c.day,start:c.start,end:c.end,weeks:c.weeks,notes:c.notes||''}))]);
      tableId=targetId;await save(next);toast('已保存 '+(target.courses.length-before)+' 个上课安排。');
    }});}finally{openingCourseImport=false;}
  }
  element.addEventListener('click',event=>{
    const b=event.target.closest('[data-course]');if(!b)return;
    run(async()=>{
      switch(b.dataset.course){
        case 'new-table':tableForm();break;case 'manage':manage();break;case 'manage-courses':manageCourses();break;case 'add':editCourse();break;case 'edit':editCourse(b.dataset.id);break;
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
