import { isNativeApp } from './native.js';
export const PAGES = {
  capture: { route: '/import', title: '导入通知', subtitle: '上传截图或粘贴文字，提取后进入任务确认页面。', symbol: 'scan' },
  review: { route: '/import/review', title: '确认任务', subtitle: '逐项核对任务名称、截止日期和具体要求，确认后保存。', symbol: 'check' },
  home: { route: '/home', title: '首页', subtitle: '从一条通知、一段话开始，收好今天的学习安排。', symbol: 'home' },
  all: { route: '/tasks', title: '全部待办', subtitle: '沿着截止时间，一件一件完成。', symbol: 'calendar' },
  upcoming: { route: '/upcoming', title: '即将截止', subtitle: '只看未来 3 天（72 小时）内到期的未完成任务。', symbol: 'clock' },
  overdue: { route: '/overdue', title: '已逾期', subtitle: '整理错过的安排，选一件重新开始。', symbol: 'alert' },
  undated: { route: '/undated', title: '暂无截止日期', subtitle: '先收好这些事，时间明确后再安排。', symbol: 'inbox' },
  completed: { route: '/completed', title: '已完成', subtitle: '完成的每一步都留在这里，也可以随时恢复。', symbol: 'circle' },
};

export function readRoute() {
  return Object.keys(PAGES).find(key => `#${PAGES[key].route}` === location.hash) || 'home';
}

const tools = (query, icon, escape) => `<div class="task-tools"><label class="search-box">${icon('search')}<input id="task-search" type="search" placeholder="搜索任务或具体要求" aria-label="搜索任务" value="${escape(query)}"></label><button class="button button-subtle" data-action="export">${icon('calendar')}<span>${isNativeApp() ? '日历自动同步' : '导出日历'}</span></button></div>`;
const listPanel = (view, title, query, icon, escape) => `<section class="task-section glass ${view}-task-panel" aria-label="${title}"><div class="task-toolbar"><h2 class="list-title">${title}</h2>${tools(query, icon, escape)}</div><div id="task-list"></div></section>`;

function homePage(state, counts, icon) {
  return `<section class="capture-card glass home-capture"><div class="capture-copy"><span class="feature-label">${icon('spark')} 给学习，留一点从容</span><h2>把通知收好，<br>把下一步安排好。</h2><p>上传课程截图，自动整理任务和截止日期。<br>每一项都由你检查、确认后保存。</p><div class="capture-actions"><button class="button button-primary" data-action="import">${icon('scan')} 识别课程截图 ${icon('arrow')}</button><button class="text-button" data-action="example">试试示例</button></div><span class="capture-note">${icon('shield')} 图片和文字只在你的设备上处理</span></div><div class="capture-art" aria-hidden="true"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="floating-tag tag-one">${icon('check')} 等你确认</div><div class="paper paper-back"></div><div class="paper paper-front"><span class="paper-symbol">${icon('book')}</span><span class="paper-line line-dark"></span><span class="paper-line"></span><span class="paper-line line-short"></span><div class="paper-divider"></div><div class="mini-task"><i>✓</i><span></span></div><div class="mini-task"><i>✓</i><span></span></div><div class="mini-task"><i></i><span></span></div></div><div class="floating-tag tag-two">${icon('calendar')} 让每件事，都有着落</div><span class="art-spark spark-one">✦</span><span class="art-spark spark-two">✧</span></div></section>
  <div class="home-method-heading"><h2>也可以这样添加</h2><span>选择你顺手的方式就好</span></div><section class="home-methods" aria-label="其他任务添加方式"><article class="entry-method voice-entry glass"><span class="method-symbol">${icon('mic')}</span><div><span class="method-eyebrow">说出来，也能记下来</span><h3>语音输入</h3><p>说出作业内容，转成文字后再逐项确认。</p><small>本地中文识别 · 首次需准备语音资源</small></div><button class="button button-primary" data-action="voice">${icon('mic')} 开始语音输入</button></article><article class="entry-method manual-entry glass"><span class="method-symbol">${icon('edit')}</span><div><span class="method-eyebrow">随手记下来</span><h3>手动添加</h3><p>直接填写任务名称、截止日期和具体要求。</p></div><button class="button button-light" data-action="add" id="home-manual">${icon('plus')} 手动添加</button></article></section>
  <section class="home-followup glass"><div><span>${icon('shield')} 所有添加方式，都先确认再保存</span><p>任务已经记好了吗？去时间轴看看接下来的安排。</p></div><button class="text-button" data-view="all">查看我的任务 <span data-count="all">${counts.all}</span> ${icon('arrow')}</button></section>`;
}

function allPage(state, counts, icon, escape) {
  return `<div class="intake-strip glass"><span>${icon('scan')} <strong>把通知收进时间轴</strong><small>上传截图，逐项核对后保存</small></span><div><button class="text-button" data-action="example">试试示例</button><button class="button button-primary" data-action="import">${icon('scan')} 识别课程截图</button></div></div><section class="task-section glass timeline-panel" aria-label="全部待办时间轴"><div class="task-toolbar"><h2 class="list-title">截止时间轴 <span data-count="all">${counts.all}</span></h2>${tools(state.query, icon, escape)}</div><div id="task-list"></div></section>`;
}
function upcomingPage(state, counts, icon, escape) {
  return `<section class="page-summary upcoming-summary glass">${icon('clock')}<div><span>未来 72 小时</span><h2><b data-count="upcoming">${counts.upcoming}</b> 项任务需要留意</h2><p>剩余超过三天的任务继续留在“全部待办”时间轴中。</p></div></section><section class="task-section glass timeline-panel upcoming-task-panel" aria-label="即将截止时间轴"><div class="task-toolbar"><h2 class="list-title">三天内截止时间轴</h2>${tools(state.query, icon, escape)}</div><div id="task-list"></div></section>`;
}
function overduePage(state, counts, icon, escape) {
  return `<section class="page-summary overdue-summary glass">${icon('alert')}<div><span>重新安排，也是一种进展</span><h2><b data-count="overdue">${counts.overdue}</b> 项任务已超过截止时间</h2><p>可以修改截止日期；做完的任务点击圆圈，移入已完成。</p></div></section>${listPanel('overdue', '待重新安排', state.query, icon, escape)}`;
}
function undatedPage(state, counts, icon, escape) {
  return `<section class="page-summary undated-summary glass">${icon('inbox')}<div><span>先记下，再安排</span><h2><b data-count="undated">${counts.undated}</b> 项任务还没有截止日期</h2><p>点击任务可补充日期，补充后会自动回到时间轴的对应位置。</p></div></section>${listPanel('undated', '等待安排的任务', state.query, icon, escape)}`;
}
function completedPage(state, counts, icon, escape) {
  return `<section class="page-summary completed-summary glass">${icon('circle')}<div><span>每一步，都算数</span><h2>已经完成 <b data-count="completed">${counts.completed}</b> 项学习任务</h2><p>按完成时间从近到远保留，点击勾选圆圈即可恢复。</p></div></section>${listPanel('completed', '完成记录', state.query, icon, escape)}`;
}

export function renderLearningPage(state, counts, icon, escape) {
  if (['capture', 'review'].includes(state.view)) return '<div id="import-page-host"></div>';
  return ({ home: homePage, all: allPage, upcoming: upcomingPage, overdue: overduePage, undated: undatedPage, completed: completedPage })[state.view](state, counts, icon, escape);
}
