import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTasks, extractCourse, extractDeadline, normalizeNotice } from '../src/domain.js';
import { formatSharedTasks } from '../src/sharing.js';

test('shared text keeps two tasks through Markdown breaks, escaped newlines and flattened chat copies', () => {
  const text='[拾课课程任务\n1. 第四章作业\\\n   截止时间：2026-12-30 23:59\\\n   要求：第四章作业\\\n   开始时间：2026-12-01/11:09\\\n   截止时间：2026-12-30/23:59\\\n   考试限时：不限时\n2. 统计报告\\\n   截止时间：2027-01-04（当天 00:00）\\\n   要求：100.9 KB\\\n   这是第一次作业，下周一交\\\n   BR: 作业 \\_1. 统计学\\\n   简介.pdf]';
  for (const input of [text,text.replace(/\n/g,' '),text.replace(/\n/g,'\\n')]) {
    const tasks=extractTasks(input);assert.equal(tasks.length,2);
    assert.deepEqual(tasks.map(t=>t.title),['第四章作业','统计报告']);
    assert.deepEqual(tasks.map(t=>[t.dueDate,t.dueTime]),[['2026-12-30','23:59'],['2027-01-04','']]);
    assert.match(tasks[1].details,/简介.pdf/);
  }
});

test('shared text retains every task when the first requirements contain exam times', () => {
  const tasks = [{ title: '第四章作业', dueDate: '2026-12-30', dueTime: '23:59', details: '第四章作业\n开始时间：2026-12-01/11:09/星期二\n截止时间：2026-12-30/23:59/星期三\n考试限时：不限时' },
    { title: '统计学', course: '统计学', dueDate: '2027-01-04', details: '这是第一次作业\n下周一收齐\n使用完整 A4 纸\n@所有人\nThis is the first assignment.\n@Everyone' }];
  const parsed = extractTasks(formatSharedTasks(tasks));
  assert.equal(parsed.length, 2);
  for (const [i, task] of tasks.entries()) {
    for (const key of ['title', 'dueDate', 'details']) assert.equal(parsed[i][key], normalizeNotice(task[key]));
    assert.equal(parsed[i].dueTime, task.dueTime || '');
  }
  assert.equal(parsed[0].course, ''); assert.equal(parsed[1].course, '统计学');
});

test('OCR card numbering wins over nested notifications and keeps outer deadlines local', () => {
  const text = '拾课 · 课程任务\n共 2 项\n1. 第四章作业\n截止时间：2026-12-30 23:59\n要求：第四章作业\n开始时间：2026-12-01/11:09\n截止时间：2026-12-30/23:59\n考试限时：不限时\n课程：统计学\n2. 统计学\n截止日期：2027-01-04\n要求：100.9 KB\n这是第一次作业\n下周一收齐\n1. 写出步骤\n2. 使用 A4 纸\n旧附件：作业_1.统计学简介.pdf\n拾课 · 学习任务助手';
  const tasks = extractTasks(text);
  assert.equal(tasks.length, 2); assert.deepEqual(tasks.map(t => t.title), ['第四章作业', '统计学']);
  assert.deepEqual(tasks.map(t => t.course), ['', '统计学']);
  assert.deepEqual(tasks.map(t => [t.dueDate, t.dueTime]), [['2026-12-30', '23:59'], ['2027-01-04', '']]);
  assert.match(tasks[1].details, /1\. 写出步骤\n2\. 使用 A4 纸/);
  assert.doesNotMatch(tasks[0].details, /统计学/); assert.doesNotMatch(tasks[1].details, /学习任务助手/);
});

test('a single card and an undated task do not inherit dates from quoted requirements', () => {
  const parsed = extractTasks(formatSharedTasks([{title:'复习章节', details:'参考旧截止时间：2026-12-30'}]));
  assert.equal(parsed.length, 1); assert.equal(parsed[0].dueDate, ''); assert.equal(parsed[0].dateConfirmed, true);
  const card = extractTasks('拾课 · 课程任务\n1 . 复习章节\n截止日期：2027-01-04\n要求：保留全部要求\n拾课 · 学习任务助手');
  assert.equal(card[0].title, '复习章节'); assert.equal(card[0].dueDate, '2027-01-04');
});

test('OCR spacing loss and an unreadable requirements label keep dates and both task bodies', () => {
  const tasks=extractTasks('拾课 . 课程任务\n1. 第四章作业\n截止时间 : 2026-12-3023:59\nBX: 第四章作业\n开始时间 : 2026-12-01/11:09\n截止时间 : 2026-12-30/23:59\n考试限时 : 不限时\n2. 统计报告\n截止日期 : 2027-01-04\n要求 : 下周一交\n拾课 \' 学习任务助手');
  assert.equal(tasks.length,2); assert.equal(tasks[0].dueDate,'2026-12-30');assert.equal(tasks[0].dueTime,'23:59');
  assert.match(tasks[0].details,/开始时间/);assert.equal(tasks[1].details,'下周一交');
});

test('a missing card banner is recoverable from multiple complete outer field groups', () => {
  const tasks=extractTasks('1. 第四章作业\n截止时间：2026-12-30 23:59\n要求：开始时间：2026-12-01\n截止时间：2026-12-30\n2. 统计报告\n截止日期：2027-01-04\n要求：下周一交');
  assert.deepEqual(tasks.map(t=>t.title),['第四章作业','统计报告']);
  assert.deepEqual(tasks.map(t=>t.dueDate),['2026-12-30','2027-01-04']);
});

test('decimal attachment sizes are not numbered assignments', () => {
  const tasks = extractTasks('课程通知\n12.8 KB\n完成物理练习\n要求：写出步骤');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].title, '完成物理练习');
});
test('notice headings do not become an extra task above the actual assignment', () => {
  const tasks = extractTasks('课程作业通知\n完成数学第三章习题\n截止时间：2026年12月30日 23:59');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].title, '完成数学第三章习题');
  assert.equal(tasks[0].dueDate, '2026-12-30');
  assert.equal(extractTasks('课程作业通知').length, 1);
});
test('wrapped attachment and reference message become one task with its deadline and paper requirements', () => {
  const tasks = extractTasks('物理课程群\n作业_2.力学\n练习.pdf\n28.4 KB\n这是第二次作业，请认真完成\n下周三提交\n作业采用整张纸，写上姓名\n@所有人\nThis is the assignment.\n@Everyone\n老师：作业_2.力学练习.pdf', new Date('2026-10-26T12:00:00+08:00'));
  assert.equal(tasks.length, 1); assert.equal(tasks[0].title, '作业_2.力学练习');
  assert.equal(tasks[0].dueDate, '2026-11-04'); assert.match(tasks[0].details, /整张纸/); assert.doesNotMatch(tasks[0].details, /Everyone|This is|28.4/);
});
test('English-only notices remain available and different Chinese tasks remain separate', () => {
  assert.match(extractTasks('Read chapter 3 and submit the exercise.')[0].details, /Read chapter/);
  assert.equal(extractTasks('1. 完成物理练习\n2. 完成化学实验').length, 2);
});
test('task sharing preserves titles, requirements and dates without internal IDs and round trips through extraction', () => {
  const text = formatSharedTasks([{ title: '物理练习', details: '写出步骤', dueDate: '2026-12-15', dueTime: '18:30', id: 'private-id' }, { title: '英语阅读', details: '', dueDate: '' }]);
  assert.doesNotMatch(text, /private-id/);
  const tasks = extractTasks(text);
  assert.equal(tasks.length, 2); assert.equal(tasks[0].title, '物理练习'); assert.equal(tasks[0].dueDate, '2026-12-15'); assert.equal(tasks[0].dueTime, '18:30');
  assert.equal(tasks[1].dueDate, ''); assert.equal(tasks[1].dateConfirmed, true); assert.equal(tasks[1].details, '');
  assert.throws(() => formatSharedTasks([]), /至少/);
  assert.throws(() => formatSharedTasks([{ title: 'x', details: 'x'.repeat(100000) }]), /过长/);
});

test('chat course context, wrapped relative weekdays and translated deadlines survive extraction', () => {
  const raw = '统计学课程群(88)\n作业_2.统计学简介-练习.pdf\n这是第二次作业，请认真完成\n下周\n一收齐提交\n作业使用整张纸\n@所有人\nSubmit by next\nMonday.\n@Everyone';
  const tasks = extractTasks(raw, new Date('2026-10-23T10:00:00+08:00'));
  assert.equal(tasks.length, 1); assert.equal(tasks[0].course, '统计学'); assert.equal(tasks[0].dueDate, '2026-10-26');
  assert.equal(extractCourse('作业_1.线性代数简介.pdf'), '线性代数');
  assert.equal(extractDeadline('下周—交作业', new Date('2026-10-23T10:00:00+08:00')).dueDate, '2026-10-26');
  assert.equal(extractDeadline('Submit by next\nMonday.', new Date('2026-10-23T10:00:00+08:00')).dueDate, '2026-10-26');
  const shared = formatSharedTasks([{title:'完成练习',course:'统计学',dueDate:'2026-12-30'}, {title:'阅读章节',course:'英语',dueDate:'2026-12-31'}]);
  assert.deepEqual(extractTasks(shared).map(task=>task.course), ['统计学','英语']);
});
