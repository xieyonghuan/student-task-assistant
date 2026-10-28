import './style.css';
import './mobile.css';
import './task-ui.css';
import './android-ui.css';
import './drafts.css';
import { watchMobileViewport } from './viewport.js';
import { version as APP_VERSION } from '../package.json';
import { installState, installApp, onInstallChange } from './install.js';
import { PAGES, readRoute, renderLearningPage } from './pages.js';
import { newId, extractTasks, findDuplicates, sanitizeTask, validateTask, taskGroup, dueTimestamp, sortTasks, REMINDERS, localDate } from './domain.js';
import { loadTasks, putTask, deleteTask, parseBackup, restoreTasks, loadDraft, putDraft, deleteDraft, putTaskWithDraft } from './storage.js';
import { createImportFlow } from './import-flow.js';
import { receiveSharedItem, formatSharedTasks } from './sharing.js';
import { createTaskCard } from './task-card.js';
import { createCalendar } from './calendar.js';
import { registerOffline, offlineStatus, prepareOffline } from './offline.js';
import { isNativeApp, nativeCall } from './native.js';
import { calendarStatus, setCalendarEnabled, syncCalendar } from './calendar-sync.js';
import { createTimetable } from './timetable.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  home: '<path d="m3 10 9-7 9 7v10H4V10m5 10v-7h6v7"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  book: '<path d="M4 4h11a5 5 0 0 1 5 5v11H9a5 5 0 0 1-5-5z"/><path d="M8 4v16m4-10 2 2 4-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="m12 3 10 17H2zM12 9v4m0 3v1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  inbox: '<path d="M4 5h16v14H4zM4 13h5l1 3h4l1-3h5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M6 12h12M8 8h8m-8 8h5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 11 6-4M9 13l6 4"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h11a7 7 0 1 1 0 14"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v.1"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m5-12-3 4 3 4"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
const state = { tasks: [], view: readRoute(), query: '', offlineReady: false, resourceBytes: 0, storageError: false, calendarError: '' };
const timetable = isNativeApp() ? createTimetable({ openDialog, esc, toast }) : null;
try { state.sidebarCollapsed = localStorage.getItem('shike-sidebar-collapsed') === 'true'; }
catch { state.sidebarCollapsed = false; }
let importSession;
let openingImport = false, pendingImportWrites = Promise.resolve(), manualWrites = Promise.resolve();
const isImportView = view => ['capture', 'review'].includes(view);
let toastTimer;
const savingIds = new Set();
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, error ? 7000 : 4000);
}
async function syncSavedTasks() {
  try { await syncCalendar(state.tasks); if (state.calendarError) { state.calendarError = ''; render(); } }
  catch (error) { state.calendarError = error.message; render(); }
}
async function reloadTasks() { state.tasks = await loadTasks(); render(); await syncSavedTasks(); }
async function safely(action) { try { await action(); } catch (e) { toast(e.message || '操作未完成，请重试。', true); } }
function counts() {
  const result = { all: 0, scheduled: 0, upcoming: 0, overdue: 0, undated: 0, completed: 0 };
  for (const task of state.tasks) { const group = taskGroup(task); result[group]++; if (group !== 'completed') result.all++; }
  return result;
}
function navItem(view, label, symbol, count) {
  const active = state.view === view || (view === 'home' && isImportView(state.view));
  return `<button class="nav-item ${active ? 'active' : ''}" data-view="${view}" title="${label}" aria-label="${label}${count === null ? '' : `，${count} 项`}" ${active ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${count === null ? '' : `<span class="nav-count">${count}</span>`}</button>`;
}
function applySidebarState() {
  document.documentElement.classList.toggle('sidebar-collapsed', isNativeApp() && state.sidebarCollapsed);
  const button = $('.sidebar-toggle');
  if (button) {
    const label = state.sidebarCollapsed ? '展开侧栏' : '收起侧栏';
    button.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    button.setAttribute('aria-label', label); button.title = label;
  }
}
function scrollPageToTop() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('.native-content')?.scrollTo({ top: 0, behavior: 'instant' });
}
function render() {
  if (isImportView(state.view) && !importSession) { if (!openingImport && !receivingShare) startImport(); return; }
  if (state.view === 'review' && !importSession.canReview()) { history.replaceState(null, '', '#' + PAGES.capture.route); state.view = 'capture'; }
  const n = counts();
  const page = PAGES[state.view];
  const native = isNativeApp();
  document.documentElement.classList.toggle('native-app', native);
  document.documentElement.classList.toggle('import-open', isImportView(state.view));
  const keepImportPosition = isImportView(state.view) && $('.workspace')?.dataset.page === state.view;
  const previousScroll = keepImportPosition ? { left: scrollX, top: scrollY } : null;
  const contentScroll = keepImportPosition ? $('.native-content')?.scrollTop : null;
  const inputFocus = keepImportPosition && importSession.element.contains(document.activeElement) ? document.activeElement : null;
  const installed = isNativeApp() || installState().installed;
  document.title = `${page.title} · 拾课`;
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  $('#app').innerHTML = `<div class="app-shell">
    <aside class="sidebar glass"><div class="sidebar-heading"><a class="brand" href="#/home" aria-label="拾课首页"><span class="brand-mark">${icon('book')}</span><span>拾课<small>STUDY SPACE</small></span></a>${native ? `<button class="icon-button sidebar-toggle" data-action="sidebar-toggle" aria-label="收起侧栏" aria-expanded="true" aria-controls="learning-navigation">${icon('panel')}</button>` : ''}</div>
      <p class="nav-caption">我的学习</p><nav id="learning-navigation" aria-label="任务分类">
        ${navItem('home', '首页', 'home', null)}
        ${native ? navItem('timetable', '课程表', 'calendar', null) : ''}
        ${navItem('all', '全部待办', 'grid', n.all)}${navItem('upcoming', '即将截止', 'clock', n.upcoming)}${navItem('overdue', '已逾期', 'alert', n.overdue)}${navItem('undated', '暂无截止日期', 'inbox', n.undated)}
        <div class="nav-divider"></div>${navItem('completed', '已完成', 'circle', n.completed)}
      </nav>
      ${native ? `<div class="sidebar-bottom native-sidebar-status" title="离线识别资源已内置">${icon('shield')}<span>离线识别资源已内置</span></div>` : `<div class="sidebar-bottom"><div class="offline-card"><span class="status-dot ${state.offlineReady ? 'ready' : ''}"></span><strong>${state.offlineReady ? '离线资源已就绪' : '准备你的离线空间'}</strong><p>${state.offlineReady ? '识别与任务管理，无需联网' : '首次准备后，断网也能识别'}</p><button class="text-button" data-action="settings">${state.offlineReady ? '管理本地数据' : '准备离线使用'} ${icon('arrow')}</button></div><button class="nav-item settings-nav" data-action="settings" aria-label="设置与帮助">${icon('settings')}<span>设置与帮助</span></button><div class="sidebar-foot">只留在你的设备上 ${icon('shield')}</div></div>`}
    </aside>
    <main class="workspace" data-page="${state.view}">${native ? '' : `<header class="topbar"><span class="breadcrumb">我的学习空间 <span>/</span> ${page.title}</span><div class="topbar-actions"><span class="privacy-badge">${icon('shield')} 本地私密存储</span><button class="button button-light install-button" data-action="install" ${installed ? 'disabled' : ''}>${icon('download')}<span>${installed ? '已安装到桌面' : '安装到桌面'}</span></button><button class="avatar" data-action="settings" aria-label="打开设置">学</button></div></header>`}
      ${native ? '<div class="native-content">' : ''}<section class="page-heading"><div><p class="eyebrow">${esc(date)}</p><h1>${page.title}</h1><p class="page-subtitle">${page.subtitle}</p></div>${isImportView(state.view) ? `<button class="button button-light" data-action="exit-import">${icon('close')} 退出添加</button>` : state.view === 'timetable' ? `<button class="button button-light" data-view="home">返回首页</button>` : state.view === 'home' ? `<button class="button button-light" data-view="all">${icon('calendar')} 查看全部待办</button>` : `<button class="button button-light" data-action="add">${icon('plus')} 手动添加</button>`}</section>
      ${state.storageError ? '<div class="error-banner" role="alert">无法打开本地存储。请退出无痕模式、检查存储空间后重新打开。本次无法保存任务。</div>' : ''}
      ${state.calendarError ? `<div class="error-banner" role="alert">任务已保存在拾课中，日历尚未同步：${esc(state.calendarError)} <button class="text-button" data-action="calendar">检查日历同步</button></div>` : ''}
      ${state.view === 'home' ? draftBanner() : ''}${renderLearningPage(state, n, icon, esc)}


      ${native ? `</div>${state.view === 'home' ? `<footer class="native-footer"><div class="native-utility"><span class="privacy-badge">${icon('shield')} 本地私密存储</span><button class="button button-light" data-action="settings" aria-label="打开设置">${icon('settings')}<span>设置与帮助</span></button></div></footer>` : ''}` : `<footer class="workspace-foot"><span>${icon('shield')} 安心学习，数据只属于你</span><span>拾课 · 学习任务助手</span></footer>`}
    </main></div>`;
  applySidebarState();
  if (isImportView(state.view)) {
    $('#import-page-host').append(importSession.element);
    importSession.setStage(state.view);
    inputFocus?.focus({ preventScroll: true });
    if (previousScroll) window.scrollTo({ ...previousScroll, behavior: 'instant' });
    if (contentScroll != null) $('.native-content').scrollTop = contentScroll;
  }
  renderTaskList();
  if (state.view === 'timetable' && timetable) timetable.mount($('#timetable-page-host'));
  if (native && state.view === 'home') {
    const courses = document.createElement('button'); courses.className = 'button button-light'; courses.dataset.view = 'timetable';
    courses.innerHTML = icon('calendar') + ' 我的课程表'; $('.home-followup').append(courses);
    const button = document.createElement('button'); button.className = 'text-button'; button.dataset.action = 'receive-share';
    button.textContent = '接收 / 粘贴通知'; button.title = '接收系统分享，或提取已复制的文字'; $('.home-followup').append(button);
  }
  if (state.view === 'home' && (state.importDraft || state.manualDraft)) {
    const resume = $('.home-followup .text-button');
    resume.removeAttribute('data-view'); resume.dataset.action = 'resume-drafts';
    resume.innerHTML = icon('undo') + ' 恢复上次内容';
  }
  $('#task-search')?.addEventListener('input', event => { state.query = event.target.value; renderTaskList(); });
}

function dueLabel(task) {
  if (!task.dueDate) return '暂无截止日期';
  const [year, month, day] = task.dueDate.split('-');
  return `${year === String(new Date().getFullYear()) ? '' : `${year}年`}${Number(month)}月${Number(day)}日 · ${task.dueTime || '00:00（仅日期）'}`;
}
function taskCard(task) {
  const completed = !!task.completedAt;
  return `<article class="task-card ${completed ? 'is-complete' : ''}"><button class="complete-button ${completed ? 'checked' : ''}" data-action="toggle" data-id="${esc(task.id)}" aria-label="${completed ? '恢复任务：' : '标为已完成：'}${esc(task.title)}">${completed ? icon('check') : ''}</button><button class="task-content" data-action="edit" data-id="${esc(task.id)}">${task.course ? `<small class="course-label">课程：${esc(task.course)}</small>` : ''}<strong>${esc(task.title)}</strong>${task.details ? `<p>${esc(task.details)}</p>` : ''}<span class="due-label ${taskGroup(task) === 'overdue' ? 'is-overdue' : ''}">${icon(task.dueDate ? 'calendar' : 'inbox')}${esc(dueLabel(task))}</span></button><div class="task-card-actions"><button class="icon-button" data-action="share-task" data-id="${esc(task.id)}" aria-label="分享任务：${esc(task.title)}">${icon('share')}</button><button class="icon-button" data-action="edit" data-id="${esc(task.id)}" aria-label="编辑任务：${esc(task.title)}">${icon('edit')}</button><button class="icon-button danger-hover" data-action="delete" data-id="${esc(task.id)}" aria-label="删除任务：${esc(task.title)}">${icon('trash')}</button></div></article>`;
}
function renderTaskList() {
  if (!$('#task-list')) return;
  const query = state.query.trim().toLowerCase();
  let tasks = state.tasks.filter(t => (state.view === 'completed' ? !!t.completedAt : !t.completedAt));
  if (!['all', 'completed'].includes(state.view)) tasks = tasks.filter(t => taskGroup(t) === state.view);
  if (query) tasks = tasks.filter(t => `${t.course || ''}\n${t.title}\n${t.details}`.toLowerCase().includes(query));
  const list = $('#task-list');
  if (!tasks.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-illustration">${icon(query ? 'search' : state.view === 'completed' ? 'circle' : 'inbox')}<span>✦</span></div><h3>${query ? '没有找到相关任务' : state.view === 'completed' ? '完成的每件事，都会留在这里' : state.view === 'all' ? '第一件小事，从这里开始' : '这里暂时没有任务'}</h3><p>${query ? '换个关键词试试，也可以清空搜索。' : state.view === 'completed' ? '完成任务后点一下圆圈，就能把它收好。' : '上传一张课程截图，或手动记下你的学习安排。'}</p>${query ? '<button class="text-button" data-action="clear-search">清空搜索</button>' : state.view !== 'completed' ? `<button class="button button-light" data-action="add">${icon('plus')} 添加第一项任务</button>` : ''}</div>`;
    return;
  }
  if (['all', 'upcoming'].includes(state.view)) {
    const dated = sortTasks(tasks.filter(t => t.dueDate));
    const dates = [...new Set(dated.map(t => t.dueDate))];
    const undated = tasks.filter(t => !t.dueDate);
    list.innerHTML = `<div class="task-timeline" aria-label="按截止日期排列的任务">${dates.map(date => {
      const entries = dated.filter(t => t.dueDate === date);
      const [year, month, day] = date.split('-');
      const group = taskGroup(entries[0]);
      const label = group === 'overdue' ? '已逾期' : group === 'upcoming' ? '三天内截止' : '计划中';
      return `<section class="timeline-entry ${group}" data-date="${date}"><div class="timeline-date"><small>${year}年</small><strong>${Number(month)}月${Number(day)}日</strong><span>${label}</span></div><div class="timeline-tasks">${entries.map(taskCard).join('')}</div></section>`;
    }).join('')}${undated.length ? `<section class="timeline-entry undated" data-date="undated"><div class="timeline-date"><small>稍后安排</small><strong>暂无日期</strong><span>${undated.length} 项任务</span></div><div class="timeline-tasks">${sortTasks(undated).map(taskCard).join('')}</div></section>` : ''}</div>`;
    return;
  }
  const labels = { upcoming: ['三天内截止', '已按截止时间排列'], overdue: ['已逾期', '可以调整日期，重新安排'], undated: ['暂无截止日期', '留一点弹性，也别忘了回来看看'], completed: ['已完成', '已完成任务可以恢复'] };
  const groups = [state.view];
  list.innerHTML = groups.map(group => {
    let entries = tasks.filter(t => taskGroup(t) === group);
    if (!entries.length) return '';
    entries = group === 'completed' ? entries.sort((a, b) => b.completedAt.localeCompare(a.completedAt)) : sortTasks(entries);
    return `<section class="task-group"><div class="group-heading"><h3><span class="group-dot ${group}"></span>${labels[group][0]} <small>${entries.length}</small></h3><span>${labels[group][1]}</span></div>${entries.map(taskCard).join('')}</section>`;
  }).join('');
}

function refreshTimedViews() {
  renderTaskList();
  const n = counts();
  $$('.nav-item[data-view]').forEach(button => {
    const key = button.dataset.view;
    if (key === 'home' || key === 'timetable') return;
    $('.nav-count', button).textContent = n[key];
    button.setAttribute('aria-label', `${PAGES[key].title}，${n[key]} 项`);
  });
  $$('[data-count]').forEach(el => { el.textContent = n[el.dataset.count]; });
}

let dialogCounter = 0;
function openDialog(title, subtitle, content, { wide = false, onClose } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = `modal glass ${wide ? 'wide-modal' : ''}`;
  const titleId = `dialog-title-${++dialogCounter}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `<div class="modal-header"><div><h2 id="${titleId}">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="icon-button modal-close" aria-label="关闭窗口">${icon('close')}</button></div><div class="modal-body">${content}</div>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  $('.modal-close', dialog).onclick = close;
  dialog.addEventListener('close', () => { onClose?.(); dialog.remove(); }, { once: true });
  dialog.showModal();
  return dialog;
}

function installHelp() {
  return openDialog('安装到平板桌面', '先在平板浏览器打开正式 HTTPS 网址，再安装。', `<div class="notice">${icon('home')}<p>在浏览器菜单里选择“安装应用”或“添加到桌面”。不同浏览器的入口名称可能不同。</p></div><p>安装后，先到“设置与帮助”准备离线截图资源；需要语音时，再在首页准备语音资源。</p><p class="install-migration">如果电脑里已有任务：先在电脑的设置中导出备份，再在平板同一应用的设置中恢复。任务不会通过账号自动同步。</p>`);
}
onInstallChange(() => {
  const state = installState();
  $$('[data-action="install"]').forEach(button => {
    button.disabled = state.installed;
    const label = $('span', button);
    if (label) label.textContent = state.installed ? '已安装到桌面' : '安装到桌面';
  });
});

function taskFields(task, prefix = '') {
  return `<label class="field">课程名称 <span class="optional">可修改或补充</span><input name="course" maxlength="80" placeholder="例如：运筹学" value="${esc(task.course)}"></label><label class="field">任务名称 <span class="required">*</span><input name="title" maxlength="120" required placeholder="例如：完成高等数学第三章习题" value="${esc(task.title)}"></label><div class="date-fields"><label class="field">截止日期<input name="dueDate" type="date" min="1900-01-01" max="2200-12-31" value="${esc(task.dueDate)}"></label><label class="field">具体时间 <span class="optional">可不填</span><input name="dueTime" type="time" value="${esc(task.dueTime)}"></label></div><p class="field-note">${icon('help')} 只选日期时，按当天 00:00 截止。</p><label class="field">具体要求<textarea name="details" rows="5" maxlength="20000" placeholder="记录作业内容、提交要求等…">${esc(task.details)}</textarea></label><p class="form-error" id="${prefix}form-error" role="alert"></p>`;
}
function readTaskFields(form, base, trim = true) {
  const data = new FormData(form);
  const course = String(data.get('course') || '');
  const title = String(data.get('title') || ''), details = String(data.get('details') || '');
  return { ...base, course: trim ? course.trim() : course, title: trim ? title.trim() : title, dueDate: String(data.get('dueDate') || ''), dueTime: String(data.get('dueTime') || ''), details: trim ? details.trim() : details };
}
function confirmDate(task, callback, onChange = () => {}) {
  const dialog = openDialog('确认截止日期', `对应任务：${task.title}`, `<div class="notice">${icon('calendar')}<p>${esc(task.dateHint || '请确认此任务的截止日期，或选择暂无截止日期。')}</p></div><label class="field">截止日期<input id="confirm-date" type="date" min="1900-01-01" max="2200-12-31" value="${esc(task.dueDate)}"></label><label class="field">具体时间 <span class="optional">可不填</span><input id="confirm-time" type="time" value="${esc(task.dueTime)}"></label><p class="field-note">只选择日期时，按当天 00:00 截止。</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button button-light" id="no-date">暂无截止日期</button><button class="button button-primary" id="choose-date">确认日期</button></div>`);
  dialog.oninput = () => onChange({ ...task, dueDate: $('#confirm-date', dialog).value, dueTime: $('#confirm-time', dialog).value, dateConfirmed: false });
  $('#no-date', dialog).onclick = () => { dialog.close(); callback({ ...task, dueDate: '', dueTime: '', dateConfirmed: true }); };
  $('#choose-date', dialog).onclick = () => {
    const selected = { ...task, dueDate: $('#confirm-date', dialog).value, dueTime: $('#confirm-time', dialog).value };
    const error = !selected.dueDate ? '请选择日期，或点击“暂无截止日期”。' : validateTask(selected);
    if (error) { $('.form-error', dialog).textContent = error; return; }
    dialog.close(); callback({ ...selected, dateConfirmed: true });
  };
}
function duplicateDialog(task, matches, onDecision) {
  let decided = false;
  const dialog = openDialog('可能与已有任务重复', '请选择如何处理这项任务。', `<div class="notice warning">${icon('alert')}<p>准备保存：<strong>${esc(task.title)}</strong></p></div><label class="field">相似的已有任务<select id="duplicate-target">${matches.map(t => `<option value="${esc(t.id)}">${esc(t.title)}${t.completedAt ? '（已完成）' : ''}</option>`).join('')}</select></label><p class="field-note">修改原任务会更新名称、日期和具体要求，并保留原任务的完成状态。</p><div class="stacked-actions"><button class="button button-primary" id="replace-original">修改选中的原任务</button><button class="button button-light" id="save-separate">仍然新增任务</button><button class="text-button" id="skip-duplicate">跳过本项</button></div>`);
  dialog.addEventListener('close', () => { if (!decided) onDecision('cancel'); });
  $('#replace-original', dialog).onclick = () => { const id = $('#duplicate-target', dialog).value; decided = true; dialog.close(); onDecision('replace', id); };
  $('#save-separate', dialog).onclick = () => { decided = true; dialog.close(); onDecision('new'); };
  $('#skip-duplicate', dialog).onclick = () => { decided = true; dialog.close(); onDecision('skip'); };
}
function saveWithChecks(task, { excludeId, afterSave, onSkip = () => {}, onCancel = () => {}, onError = () => {}, onDateChange = () => {}, persistTask = putTask } = {}) {
  if (savingIds.has(task.id)) return;
  if (state.storageError) { toast('本地存储不可用，暂时无法保存。', true); onError(); return; }
  const error = validateTask(task);
  if (error) { toast(error, true); onError(); return; }
  if (!task.dateConfirmed) { confirmDate(task, result => saveWithChecks(result, { excludeId, afterSave, onSkip, onCancel, onError, onDateChange, persistTask }), onDateChange); return; }
  const save = (candidate) => safely(async () => {
    if (savingIds.has(task.id)) return;
    savingIds.add(task.id);
    try { await persistTask(sanitizeTask(candidate)); await reloadTasks(); afterSave?.(); toast('任务已保存在这台设备上'); }
    catch (error) { onError(error); throw error; }
    finally { savingIds.delete(task.id); }
  });
  const duplicates = findDuplicates(task, state.tasks, excludeId);
  if (duplicates.length) {
    duplicateDialog(task, duplicates, (choice, id) => {
      if (choice === 'cancel') { onCancel(); return; }
      if (choice === 'skip') { onSkip(); return; }
      if (choice === 'replace') { const original = state.tasks.find(t => t.id === id); save({ ...task, id, createdAt: original.createdAt, completedAt: original.completedAt }); }
      else save(task);
    });
  } else save(task);
}
function draftBanner() {
  const imported = state.importDraft, manual = state.manualDraft;
  if (!imported && !manual) return '';
  return '<section class="draft-banner glass" aria-label="未完成草稿"><strong>还有未完成的内容，可继续上次填写</strong><div>' +
    (imported ? '<button class="button button-light" data-action="resume-import">继续上次导入</button><button class="text-button" data-action="discard-import">放弃导入草稿</button>' : '') +
    (manual ? '<button class="button button-light" data-action="resume-manual">恢复填写草稿</button><button class="text-button" data-action="discard-manual">放弃填写草稿</button>' : '') + '</div></section>';
}
function manualAction(action) {
  const next = manualWrites.catch(() => {}).then(action);
  manualWrites = next;
  return next;
}
async function editTask(id, restoring = false) {
  await manualWrites.catch(() => {});
  const draft = state.manualDraft;
  if (!restoring && draft && (draft.originalId || undefined) !== id) {
    const dialog = openDialog('还有未完成的填写', '可先继续上次内容，或放弃它后开始新的填写。', '<button class="button button-primary" id="resume-before-edit">继续上次填写</button><button class="text-button" id="discard-before-edit">放弃草稿并继续</button>');
    $('#resume-before-edit', dialog).onclick = () => { dialog.close(); editTask(undefined, true); };
    $('#discard-before-edit', dialog).onclick = () => safely(async () => { await manualAction(() => deleteDraft('manual')); state.manualDraft = null; dialog.close(); editTask(id); });
    return;
  }
  const restored = draft && (restoring || (draft.originalId || undefined) === id) ? draft : null;
  const originalId = restored ? restored.originalId : id;
  const original = originalId ? state.tasks.find(task => task.id === originalId) : null;
  const fields = restored?.task;
  const task = original ? { ...original, ...(fields ? { title: fields.title, details: fields.details, dueDate: fields.dueDate, dueTime: fields.dueTime } : {}), dateConfirmed: true }
    : fields ? { ...fields, id: originalId ? newId() : fields.id }
    : { id: newId(), title: '', details: '', dueDate: '', dueTime: '', dateConfirmed: false };
  let settled = false;
  const dialog = openDialog(original ? '编辑学习任务' : '记下一件学习小事', '输入自动暂存在本机；关闭后可恢复，保存后自动清理。', '<form id="task-form">' + taskFields(task) + '<p id="manual-draft-state" class="source-note" role="status">填写内容会自动保存为草稿。</p><div class="modal-actions"><button class="button button-light" type="button" id="cancel-edit">取消</button><button class="text-button" type="button" id="discard-edit">放弃草稿</button><button class="button button-primary" type="submit">' + (original ? '保存修改' : '保存任务') + '</button></div></form>');
  const form = $('#task-form', dialog);
  function preserve() {
    if (settled) return;
    const record = { id: 'manual', originalId: original?.id || null, task: readTaskFields(form, task, false), updatedAt: new Date().toISOString() };
    if (!original && !['course', 'title', 'details', 'dueDate', 'dueTime'].some(name => record.task[name].trim())) {
      state.manualDraft = null;
      manualAction(() => deleteDraft('manual')).catch(error => { $('#manual-draft-state', dialog).textContent = error.message; });
      return;
    }
    state.manualDraft = record;
    $('#manual-draft-state', dialog).textContent = '正在保存草稿…';
    manualAction(() => putDraft(record)).then(() => { $('#manual-draft-state', dialog).textContent = '草稿已自动保存在本机。'; }, error => { $('#manual-draft-state', dialog).textContent = '草稿保存失败：' + error.message; });
  }
  form.oninput = preserve;
  form.onchange = preserve;
  $('#cancel-edit', dialog).onclick = () => { dialog.close(); render(); };
  $('#discard-edit', dialog).onclick = () => safely(async () => { settled = true; await manualAction(() => deleteDraft('manual')); state.manualDraft = null; dialog.close(); render(); });
  form.onsubmit = event => {
    event.preventDefault();
    const candidate = readTaskFields(form, task);
    if (candidate.dueDate) candidate.dateConfirmed = true;
    const error = validateTask(candidate);
    if (error) { $('#form-error', dialog).textContent = error; return; }
    saveWithChecks(candidate, { excludeId: original?.id, persistTask: saved => manualAction(async () => {
      await putTaskWithDraft(saved, 'manual', null); settled = true; state.manualDraft = null;
    }), onDateChange: changed => { for (const name of ['dueDate', 'dueTime']) form.elements[name].value = changed[name]; preserve(); }, afterSave: () => dialog.close() });
  };
}

const EXAMPLE = '课程任务通知\n1. 高等数学：完成第三章课后习题\n截止时间：10月30日。请写出计算过程。\n2. 大学英语：提交阅读报告\n请于周五提交，要求不少于300字。\n3. 计算机基础：整理课堂笔记\n要求：总结本章知识点，暂无截止日期。';
async function startImport(example = false, initialText = '', mode = 'image') {
  if (openingImport) return;
  openingImport = true;
  const returnView = isImportView(state.view) ? 'home' : state.view;
  try {
    if (importSession) { pendingImportWrites = importSession.dispose(); importSession = undefined; }
    await pendingImportWrites;
    if ((example || initialText) && state.importDraft) {
      if (!window.confirm('这会替换未保存的导入草稿，已保存的任务不受影响。继续吗？')) { example = false; initialText = ''; }
      else { await deleteDraft('import'); state.importDraft = null; }
    }
    importSession = createImportFlow({ restored: state.importDraft, example: example ? EXAMPLE : '', initialText, mode, returnView, ui: {
      $, $$, esc, icon, taskFields, readTaskFields, saveWithChecks, confirmDate, toast, safely,
      onDraft: draft => { state.importDraft = draft; },
      goTo: (view, replace = false) => {
        if (location.hash !== '#' + PAGES[view].route) history[replace ? 'replaceState' : 'pushState'](null, '', '#' + PAGES[view].route);
        state.view = view; state.query = ''; render(); scrollPageToTop();
        const heading = $('.review-heading, .review-done h3, #ocr-message');
        if (view === 'review' && heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      },
      exit: view => { location.hash = PAGES[view].route; },
      finish: () => { location.hash = PAGES.all.route; },
    } });
    importSession.open();
  } catch (error) { toast(error.message, true); }
  finally { openingImport = false; }
}

let shareReady = false, receivingShare = false, shareAgain = false, pendingPaste = false;
async function receiveInbox(manual = false) {
  if (!isNativeApp() || !shareReady) return;
  if (manual) pendingPaste = true;
  if (receivingShare) { shareAgain = true; return; }
  if (openingImport) { setTimeout(() => receiveInbox(manual), 200); return; }
  receivingShare = true;
  let received = 0, error, shouldResume = false;
  try {
    const items = await nativeCall('shareInbox');
    if (!Array.isArray(items)) throw new Error('分享队列暂时不可用，请稍后重试。');
    if (!items.length) { const paste = pendingPaste; pendingPaste = false; if (paste) await pasteNotification(); return; }
    pendingPaste = false;
    shouldResume = true;
    $('#app').inert = true;
    await manualWrites;
    $$('dialog[open]').forEach(dialog => dialog.close());
    if (importSession) { pendingImportWrites = importSession.dispose(); importSession = undefined; }
    await pendingImportWrites;
    for (const item of items) {
      const result = await receiveSharedItem(item);
      if (!result.duplicate) received++;
      await nativeCall('shareConsume', { id: item.id });
    }
  } catch (failure) { pendingPaste = false; error = failure; }
  finally {
    if (shouldResume) {
      state.importDraft = await loadDraft('import').catch(() => state.importDraft);
      if (state.importDraft) await startImport(); else render();
    }
    receivingShare = false;
    $('#app').inert = false;
    if (shouldResume && !state.importDraft && isImportView(state.view)) { state.view = 'home'; history.replaceState(null, '', '#/home'); render(); }
    if (error) toast('分享尚未全部处理：' + error.message, true);
    else if (received) toast(`已接收 ${received} 次分享，请核对后保存任务。`);
    if (shareAgain) { shareAgain = false; receiveInbox(); }
  }
}

async function pasteNotification() {
  let text = '';
  try { text = isNativeApp() ? (await nativeCall('readClipboard')).text : await navigator.clipboard.readText(); } catch { /* Offer a normal editable paste field below. */ }
  const accept = async value => {
    if (!value.trim()) throw new Error('请先复制课程通知文字，或在输入框中粘贴。');
    if (importSession) { pendingImportWrites = importSession.dispose(); importSession = undefined; }
    await pendingImportWrites;
    await receiveSharedItem({ id: newId(), text: value, images: [], receivedAt: Date.now() });
    state.importDraft = await loadDraft('import'); await startImport();
  };
  if (text?.trim()) { await accept(text); return; }
  const dialog = openDialog('粘贴课程通知', '复制微信、QQ 中的通知文字后，在这里粘贴并提取任务。', '<label class="field">通知文字<textarea id="paste-notice" rows="8" maxlength="100000" placeholder="长按这里粘贴通知文字"></textarea></label><p class="form-error" role="alert"></p><button class="button button-primary" id="extract-paste">提取任务</button>');
  $('#extract-paste', dialog).onclick = async () => {
    try { await accept($('#paste-notice', dialog).value); dialog.close(); }
    catch (error) { $('.form-error', dialog).textContent = error.message; }
  };
}

function shareTasks(id) {
  const tasks = sortTasks(state.tasks.filter(task => id ? task.id === id : state.view === 'completed' ? !!task.completedAt : !task.completedAt && (state.view === 'all' || taskGroup(task) === state.view)));
  if (!tasks.length) { toast('当前没有可分享的课程任务。'); return; }
  const dialog = openDialog('分享课程任务', '可以分享文字，也可以生成包含课程、截止时间和要求的图片卡片。', `<div class="share-task-options">${tasks.map(task => `<label class="export-task"><input type="checkbox" name="share-task" value="${esc(task.id)}" checked><span><strong>${esc(task.title)}</strong><small>${esc(dueLabel(task))}</small></span></label>`).join('')}</div><label class="field">分享文字<textarea id="share-preview" rows="8" readonly></textarea></label><p id="share-status" role="status"></p><div class="modal-actions share-actions"><button class="button button-light" id="copy-share">复制文字</button><button class="button button-light" id="show-card">预览图片卡片</button><button class="button button-primary" id="send-share">选择分享应用</button></div><div id="share-card-wrap" class="share-card-preview" hidden><img id="share-card-preview" alt="待分享的课程任务图片卡片"><button class="button button-primary" id="send-card">分享图片卡片</button></div>`);
  const preview = $('#share-preview', dialog), status = $('#share-status', dialog), send = $('#send-share', dialog), copy = $('#copy-share', dialog);
  const showCard = $('#show-card', dialog), cardWrap = $('#share-card-wrap', dialog);
  let cardBlob, cardURL, cardGeneration = 0;
  const selected = () => tasks.filter(task => $$('[name="share-task"]:checked', dialog).some(input => input.value === task.id));
  function clearCard() { cardGeneration++; cardBlob = null; if (cardURL) URL.revokeObjectURL(cardURL); cardURL = null; cardWrap.hidden = true; }
  dialog.addEventListener('close', clearCard);
  function update() {
    clearCard();
    try { preview.value = formatSharedTasks(selected()); status.textContent = ''; send.disabled = copy.disabled = showCard.disabled = false; }
    catch (error) { preview.value = ''; status.textContent = error.message; send.disabled = copy.disabled = showCard.disabled = true; }
  }
  dialog.addEventListener('change', update); update();
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(preview.value); status.textContent = '内容已复制，可粘贴发送。'; }
    catch { preview.focus(); preview.select(); status.textContent = '请长按或使用系统复制，再粘贴发送。'; }
  };
  showCard.onclick = async () => {
    const generation = ++cardGeneration; showCard.disabled = true; status.textContent = '正在生成任务图片卡片…';
    try {
      const blob = await createTaskCard(selected());
      if (!dialog.isConnected || generation !== cardGeneration) return;
      cardBlob = blob; if (cardURL) URL.revokeObjectURL(cardURL); cardURL = URL.createObjectURL(blob);
      $('#share-card-preview', dialog).src = cardURL; cardWrap.hidden = false;
      status.textContent = '图片卡片已生成，核对后点击“分享图片卡片”。'; cardWrap.scrollIntoView({ block: 'nearest' });
    } catch (error) { status.textContent = error.message; }
    finally { if (dialog.isConnected) showCard.disabled = !selected().length; }
  };
  $('#send-card', dialog).onclick = async () => {
    if (!cardBlob) return;
    try {
      if (isNativeApp()) {
        const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('无法读取图片卡片。')); reader.readAsDataURL(cardBlob); });
        await nativeCall('shareTaskImage', { content }); status.textContent = '已打开图片分享面板。';
      } else {
        const file = new File([cardBlob], '拾课课程任务.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: '拾课课程任务' });
        else { const link = document.createElement('a'); link.href = cardURL; link.download = file.name; link.click(); status.textContent = '图片已下载，可在相册中选择并发送。'; }
      }
    } catch (error) { if (error.name !== 'AbortError') status.textContent = error.message || '图片分享未完成，请重试。'; }
  };
  send.onclick = async () => {
    try {
      if (isNativeApp()) { await nativeCall('shareTasks', { text: preview.value }); status.textContent = '已打开系统分享面板。'; }
      else if (navigator.share) { await navigator.share({ title: '拾课课程任务', text: preview.value }); status.textContent = '分享操作已结束。'; }
      else { preview.focus(); preview.select(); status.textContent = '此浏览器没有系统分享，请复制内容后发送。'; }
    } catch (error) { if (error.name !== 'AbortError') status.textContent = '分享未完成，可复制内容后发送。'; }
  };
}

function download(content, type, filename) {
  if (isNativeApp()) {
    safely(async () => { await nativeCall('saveFile', { content, type, filename }); toast('文件已保存到你选择的位置'); });
    return;
  }
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function exportCalendar() {
  if (isNativeApp()) { calendarSettings(); return; }
  const dated = sortTasks(state.tasks.filter(t => t.dueDate));
  const undated = state.tasks.filter(t => !t.dueDate).length;
  if (!dated.length) {
    openDialog('暂时没有可导出的任务', '日历导出需要明确的截止日期。', `<div class="notice">${icon('calendar')}<p>${undated ? `有 ${undated} 项任务暂无截止日期，补充日期后就可以导出。` : '先添加一项带截止日期的任务吧。'}</p></div>`); return;
  }
  const options = tasks => tasks.map(t => `<label class="export-task"><input type="checkbox" name="export-task" value="${esc(t.id)}" checked><span><strong>${esc(t.title)}${t.completedAt ? '（已完成）' : ''}</strong><small>${esc(dueLabel(t))}</small></span></label>`).join('');
  const dialog = openDialog('带到你的日历里', '生成 .ics 文件，再通过平板的日历应用导入。', `
    <div class="notice">${icon('calendar')}<p>只记录日期的任务按<strong>当天 00:00</strong>导出。提醒以中国标准时间（UTC+8）计算。</p></div>
    <div class="export-select-bar"><strong>选择要导出的任务</strong><button class="text-button" id="select-export">全选有日期任务</button></div>
    <div class="export-list">${options(dated)}</div>
    <p class="field-note">默认选中全部有截止日期的任务，已完成任务也会标明，你可以取消勾选。${undated ? `另有 ${undated} 项暂无截止日期的任务不参与导出。` : ''}</p>
    <fieldset class="reminder-options"><legend>提前提醒</legend>${[['4320', '3 天'], ['1440', '1 天'], ['300', '5 小时'], ['60', '1 小时']].map(([value, label]) => `<label><input type="checkbox" name="reminder" value="${value}" checked> ${label}</label>`).join('')}</fieldset>
    <p class="field-note">不同版本的 ColorOS 日历可能合并或忽略部分提醒，导入后请检查。重复导入也可能产生重复日历事项。</p><p class="form-error" role="alert"></p>
    <div class="modal-actions"><button class="button button-primary" id="download-calendar">${icon('download')} 下载日历文件</button></div>`);
  $('#select-export', dialog).onclick = () => { $$('input[name="export-task"]', dialog).forEach(el => { el.checked = true; }); };
  $('#download-calendar', dialog).onclick = () => {
    const selected = $$('input[name="export-task"]:checked', dialog).map(el => state.tasks.find(t => t.id === el.value));
    if (!selected.length) { $('.form-error', dialog).textContent = '请至少选择一项任务。'; return; }
    const reminders = $$('input[name="reminder"]:checked', dialog).map(el => Number(el.value));
    download(createCalendar(selected, reminders), 'text/calendar;charset=utf-8', `拾课-学习任务-${localDate()}.ics`);
    toast('日历文件已生成，请在平板日历中导入并检查提醒');
  };
}

async function calendarSettings() {
  const dialog = openDialog('自动写入系统日历', '开启后，保存任务就会同步，不需要下载或导入文件。', `<div class="notice">${icon('calendar')}<p>在系统日历中使用<strong>拾课 · 学习任务</strong>本地日历，不需要登录云账号。</p></div><p>新增与修改会更新对应日程；完成后保留记录并撤销提醒，恢复后重新提醒。删除任务或移除截止日期会移除对应日程。默认提前 3 天、1 天、5 小时、1 小时提醒。</p><p>只同步拾课创建的日程。关闭自动同步会保留已有日程；重新开启时会按拾课当前任务更新。</p><p id="calendar-status" role="status">正在检查日历权限…</p><p class="form-error" id="calendar-error" role="alert"></p><div class="modal-actions"><button class="button button-light" id="calendar-disable" disabled>暂停自动同步</button><button class="button button-primary" id="calendar-enable" disabled>开启自动同步</button></div>`);
  const statusLabel = $('#calendar-status', dialog), errorLabel = $('#calendar-error', dialog);
  const enable = $('#calendar-enable', dialog), disable = $('#calendar-disable', dialog);
  async function refresh() {
    const status = await calendarStatus();
    if (!dialog.open) return;
    statusLabel.textContent = status.enabled && status.granted ? '自动同步已开启。请在 ColorOS 日历的日历列表中显示“拾课 · 学习任务”。' : status.enabled ? '日历权限未允许，任务仍在拾课中。点击下方按钮重新授权。' : '尚未开启自动同步，任务只保存在拾课中。';
    enable.textContent = status.enabled && status.granted ? '立即核对并同步' : '授权并开启自动同步';
    enable.disabled = !status.available; disable.disabled = !status.enabled;
    if (!status.available) errorLabel.textContent = '设备没有可用的系统日历服务，请先安装或启用系统日历。';
  }
  enable.onclick = async () => {
    enable.disabled = disable.disabled = true; errorLabel.textContent = '';
    try { await setCalendarEnabled(true); await syncCalendar(state.tasks); state.calendarError = ''; render(); if (dialog.open) statusLabel.textContent = '任务已写入系统日历。'; }
    catch (error) { if (dialog.open) errorLabel.textContent = error.message; }
    finally { await refresh().catch(error => { if (dialog.open) errorLabel.textContent = error.message; }); }
  };
  disable.onclick = async () => {
    enable.disabled = disable.disabled = true; errorLabel.textContent = '';
    try { await setCalendarEnabled(false); }
    catch (error) { if (dialog.open) errorLabel.textContent = error.message; }
    finally { await refresh(); }
  };
  await refresh();
}

let preparingOffline = false;
async function settings() {
  const dialog = openDialog('你的本地学习空间', '不需要账号，任务保存在当前设备的这个浏览器中。', `<section class="settings-block"><span class="settings-heading">${icon('shield')} 数据与隐私</span><p>图片识别与任务提取在本机完成，不上传截图或文字，不使用云端 AI。未完成导入的截图与文字仅暂存在本机草稿，整批保存完成或放弃草稿后清理，不随任务保存；语音在本机识别，录音不保存。</p><p>清除浏览器数据、卸载浏览器或更换网址，可能导致本地任务不可用。请定期导出备份。</p></section><section class="settings-block"><span class="settings-heading">${icon('download')} 离线识别资源</span><p id="offline-description">${state.offlineReady ? '资源已准备好，可以离线识别和管理任务。' : `首次使用请联网准备资源${state.resourceBytes ? `（约 ${Math.ceil(state.resourceBytes / 1024 / 1024)} MB）` : ''}。准备完成后可以断网使用。`}</p><button class="button button-light" id="prepare-offline" ${preparingOffline ? 'disabled' : ''}>${icon('download')} ${state.offlineReady ? '检查并补全离线资源' : '准备离线使用'}</button><div id="offline-progress" class="ocr-progress" hidden><i></i></div><p class="form-error" id="offline-error" role="alert"></p></section><section class="settings-block"><span class="settings-heading">${icon('inbox')} 任务备份</span><p>备份包含已保存任务的文字、日期和完成状态，不包含未保存的草稿或截图。请自行保管文件。</p><div class="inline-actions"><button class="button button-light" id="backup-export">${icon('download')} 导出备份</button><button class="button button-light" id="backup-import">${icon('upload')} 恢复备份</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div></section><section class="settings-block"><span class="settings-heading">${icon('help')} 安装到平板桌面</span><p>使用平板浏览器打开 HTTPS 安全网址，在浏览器菜单中选择“安装应用”或“添加到桌面”（入口随浏览器而异）。首次准备好离线资源后再断网使用。</p><p>电脑上的 localhost 地址只供电脑本机预览。平板需要可访问的 HTTPS 地址，才能完整使用离线安装。</p><p class="version-note">拾课 v${APP_VERSION} · 支持多图汇总确认与本机草稿恢复。</p></section>`);
  if (isNativeApp()) {
    const section = document.createElement('section'); section.className = 'settings-block';
    section.innerHTML = `<span class="settings-heading">${icon('calendar')} 系统日历</span><p>首次授权后，新增、修改、完成和删除任务会自动同步到本机日历。</p><button class="button button-light" id="open-calendar-sync">管理自动同步</button>`;
    $('.modal-body', dialog).prepend(section);
    $('#open-calendar-sync', dialog).onclick = () => { dialog.close(); safely(calendarSettings); };
    const help = $$('.settings-block', dialog).at(-1);
    help.innerHTML = `<span class="settings-heading">${icon('help')} Android 安装版</span><p>截图和语音识别资源已内置，可以直接离线使用。任务仍只保存在这个应用中。</p><p>如需迁移网页里的任务：先在原网页导出备份，再在此处恢复。升级请覆盖安装；卸载或清除应用数据前请导出备份。</p><p class="version-note">拾课 v${APP_VERSION}</p>`;
  }
  $('#prepare-offline', dialog).onclick = async () => {
    if (preparingOffline) return;
    preparingOffline = true;
    const button = $('#prepare-offline', dialog); button.disabled = true;
    $('#offline-progress', dialog).hidden = false;
    $('#offline-error', dialog).textContent = '';
    try {
      const info = await prepareOffline(progress => {
        if (!dialog.open) return;
        $('#offline-progress i', dialog).style.width = `${progress * 100}%`;
        $('#offline-description', dialog).textContent = `正在准备离线资源… ${Math.round(progress * 100)}%（可中断后继续）`;
      });
      state.offlineReady = true; state.resourceBytes = info.bytes;
      if (dialog.open) { $('#offline-description', dialog).textContent = '离线资源已就绪。现在可以断网识别截图和管理任务。'; button.textContent = '资源已准备好'; }
      render(); toast('离线资源已准备好');
    } catch (error) { if (dialog.open) $('#offline-error', dialog).textContent = error.message; else toast(error.message, true); }
    finally { preparingOffline = false; if (dialog.open) button.disabled = false; }
  };
  $('#backup-export', dialog).onclick = () => download(JSON.stringify({ format: 'shike-backup', version: 1, exportedAt: new Date().toISOString(), tasks: state.tasks }, null, 2), 'application/json;charset=utf-8', `拾课-任务备份-${localDate()}.json`);
  $('#backup-import', dialog).onclick = () => $('#backup-file', dialog).click();
  $('#backup-file', dialog).onchange = event => safely(async () => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB，请检查是否选错文件。');
    const tasks = parseBackup(await file.text());
    const overlapping = tasks.filter(t => state.tasks.some(s => s.id === t.id)).length;
    if (!window.confirm(`备份包含 ${tasks.length} 项任务，将更新 ${overlapping} 项相同 ID 的任务，其余合并保留。是否恢复？`)) return;
    await restoreTasks(tasks); await reloadTasks(); toast(`已恢复 ${tasks.length} 项任务`);
  });
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-view]');
  if (nav) { const next = PAGES[nav.dataset.view]; if (next) { if (location.hash === `#${next.route}`) { state.view = nav.dataset.view; state.query = ''; render(); } else location.hash = next.route; } return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'sidebar-toggle') {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    try { localStorage.setItem('shike-sidebar-collapsed', String(state.sidebarCollapsed)); } catch { /* Keep the current layout usable when preferences cannot be stored. */ }
    applySidebarState();
  }
  else if (action === 'import') startImport();
  else if (action === 'receive-share') receiveInbox(true);
  else if (action === 'share-task') shareTasks(id);
  else if (action === 'share-tasks') shareTasks();
  else if (action === 'resume-drafts') openDialog('恢复未完成内容', '选择要继续的草稿，也可放弃不再需要的内容。', draftBanner());
  else if (action === 'resume-import') { button.closest('dialog')?.close(); startImport(); }
  else if (action === 'resume-manual') { button.closest('dialog')?.close(); editTask(undefined, true); }
  else if (action === 'discard-import' || action === 'discard-manual') safely(async () => {
    if (!window.confirm('放弃这个草稿？已经保存的任务不会删除。')) return;
    if (action === 'discard-import') { await pendingImportWrites; await deleteDraft('import'); state.importDraft = null; }
    else { await manualWrites.catch(() => {}); await deleteDraft('manual'); state.manualDraft = null; }
    button.closest('dialog')?.close();
    render();
  });
  else if (action === 'example') startImport(true);
  else if (action === 'exit-import') location.hash = PAGES[importSession.returnView].route;
  else if (action === 'voice') safely(async () => {
    const { openVoiceInput } = await import('./voice-ui.js');
    await openVoiceInput({ openDialog, icon, onTextReady: text => startImport(false, text, 'voice') });
  });
  else if (action === 'add') editTask();
  else if (action === 'edit') editTask(id);
  else if (action === 'export') safely(exportCalendar);
  else if (action === 'settings') settings();
  else if (action === 'calendar') safely(calendarSettings);
  else if (action === 'install') safely(async () => {
    const outcome = await installApp();
    if (outcome === 'manual') installHelp();
    else if (outcome === 'accepted') toast('已提交安装请求，请按浏览器提示完成');
  });
  else if (action === 'clear-search') { state.query = ''; $('#task-search').value = ''; renderTaskList(); }
  else if (action === 'toggle') safely(async () => {
    const task = state.tasks.find(t => t.id === id);
    await putTask({ ...task, completedAt: task.completedAt ? null : new Date().toISOString(), updatedAt: new Date().toISOString() });
    await reloadTasks(); toast(task.completedAt ? '任务已恢复到待完成列表' : '已完成，又向前走了一步');
  });
  else if (action === 'delete') {
    const task = state.tasks.find(t => t.id === id);
    const dialog = openDialog('删除这项任务？', task.title, `<p>删除后无法从已完成列表恢复。${isNativeApp() ? '已开启自动同步时，对应日历事项也会移除。' : '已有的日历事项需要在日历中另行删除。'}</p><div class="modal-actions"><button class="button button-light" id="cancel-delete">保留任务</button><button class="button button-danger" id="confirm-delete">确认删除</button></div>`);
    $('#cancel-delete', dialog).onclick = () => dialog.close();
    $('#confirm-delete', dialog).onclick = () => safely(async () => { await deleteTask(id); await reloadTasks(); dialog.close(); toast('任务已删除'); });
  }
});

window.addEventListener('hashchange', () => {
  state.view = readRoute(); state.query = '';
  if (!isImportView(state.view) && importSession) { pendingImportWrites = importSession.dispose(); importSession = undefined; }
  render(); scrollPageToTop();
});

async function start() {
  watchMobileViewport();
  if (!Object.values(PAGES).some(p => `#${p.route}` === location.hash)) history.replaceState(null, '', '#/home');
  try { [state.tasks, state.importDraft, state.manualDraft] = await Promise.all([loadTasks(), loadDraft('import'), loadDraft('manual')]); }
  catch { state.storageError = true; }
  render();
  shareReady = true;
  if (!state.storageError) await receiveInbox();
  if (!state.storageError) await syncSavedTasks();
  timetable?.openTarget();
  try {
    await registerOffline();
    const status = await offlineStatus(); state.offlineReady = status.ready; state.resourceBytes = status.bytes; render();
  } catch { /* The task manager remains available if resource discovery is interrupted. */ }
  if (state.storageError) toast('无法打开本地存储，当前不能保存任务。请检查浏览器设置。', true);
  setInterval(() => { if (!document.hidden) refreshTimedViews(); }, 60000);
}
window.addEventListener('focus', refreshTimedViews);
window.addEventListener('shike-share-ready', () => receiveInbox());
window.addEventListener('focus', () => receiveInbox());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTimedViews(); });
start();





