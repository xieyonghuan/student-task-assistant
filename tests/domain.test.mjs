import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validDate, extractDeadline, extractTasks, dueTimestamp, taskGroup, sortTasks, findDuplicates, validateTask } from '../src/domain.js';
import { createCalendar, foldLine } from '../src/calendar.js';
import { parseBackup } from '../src/storage.js';

const now = new Date('2026-10-24T10:00:00+08:00');
const sampleTask = (overrides = {}) => ({ id: 'fixture-1', title: '高等数学第三章习题', details: '完成题目，写出过程；请认真核对。\n提交纸质版', dueDate: '2026-10-30', dueTime: '', createdAt: '2026-10-24T02:00:00Z', updatedAt: '2026-10-24T02:00:00Z', completedAt: null, ...overrides });

test('validates real dates, leap years, and supported year bounds', () => {
  for (const value of ['2026-10-30', '2028-02-29']) assert.equal(validDate(value), true);
  for (const value of ['', '2026-02-29', '2026-02-30', '2026-13-01', '2026-1-1', '0000-01-01', '2201-01-01']) assert.equal(validDate(value), false);
});
test('extracts explicit and current-year dates', () => {
  assert.equal(extractDeadline('截止时间2026年10月30日23:59', now).dueDate, '2026-10-30');
  assert.equal(extractDeadline('截止时间2026年10月30日23:59', now).dueTime, '23:59');
  assert.equal(extractDeadline('2026-10-30 下午5点半提交', now).dueTime, '17:30');
  assert.equal(extractDeadline('10月30日截止', now).dueTime, '');
  assert.match(extractDeadline('10月30日截止', now).dateHint, /2026/);
});
test('extracts Chinese month/day from the reported plain and labelled notices without splitting the task', () => {
  for (const notice of ['完成数学第三章习题\n十月三十号提交', '完成数学第三章习题\n截止日期十月三十号', '完成数学第三章习题\n截止日期是十月三十日']) {
    const tasks = extractTasks(notice, now);
    assert.equal(tasks.length, 1, notice);
    assert.equal(tasks[0].title, '完成数学第三章习题');
    assert.equal(tasks[0].dueDate, '2026-10-30');
    assert.equal(tasks[0].dueTime, '');
    assert.equal(tasks[0].dateConfirmed, true);
    assert.match(tasks[0].dateHint, /未写年份.*2026/);
    assert.ok(tasks[0].details.includes('十月三十'), 'Keep the original transcript for review');
  }
});
test('accepts Chinese years, mixed digits, small month/day values and spoken times', () => {
  for (const [notice, date, time] of [
    ['截止日期二零二六年十月三十一号晚上十一点五十九分', '2026-10-31', '23:59'],
    ['二〇二八年二月二十九日提交', '2028-02-29', ''],
    ['二千零二十六年十二月二十一日截止', '2026-12-21', ''],
    ['10月三十号下午三点半提交', '2026-10-30', '15:30'],
    ['一月一号提交', '2026-01-01', ''],
    ['截止日期：十一月二号', '2026-11-02', ''],
    ['截止日期十 月 三 十 号', '2026-10-30', ''],
  ]) {
    const result = extractDeadline(notice, now);
    assert.equal(result.dueDate, date, notice);
    assert.equal(result.dueTime, time, notice);
    assert.equal(result.dateConfirmed, true, notice);
  }
});
test('invalid and conflicting Chinese dates still require confirmation', () => {
  for (const notice of ['二月三十号提交', '十三月一号提交', '十月三十二号提交', '十十月三十号提交', '十月三十号或十月三十一号提交']) {
    assert.equal(extractDeadline(notice, now).dateConfirmed, false, notice);
  }
});
test('a date line does not become a task but a separately named dated assignment remains a task', () => {
  const one = extractTasks('整理英语笔记\n十月三十号交作业', now);
  assert.equal(one.length, 1);
  assert.equal(one[0].dueDate, '2026-10-30');
  const two = extractTasks('完成数学习题\n十月三十号提交英语阅读报告', now);
  assert.equal(two.length, 2);
});
test('missing, conflicting, and impossible dates require confirmation', () => {
  for (const text of ['暂无截止时间', '10月28日布置，10月30日提交', '2026年2月30日']) assert.equal(extractDeadline(text, now).dateConfirmed, false, text);
});
test('conflicting relative and absolute dates require confirmation', () => {
  const result = extractDeadline('请明天10月30日提交', now);
  assert.equal(result.dueDate, '');
  assert.equal(result.dateConfirmed, false);
});
test('splits numbered multiline notices and preserves requirements', () => {
  const tasks = extractTasks('课程通知\n1. 高等数学：完成第三章课后习题\n截止时间：10月30日。请写出计算过程。\n2. 大学英语：提交阅读报告\n请于周五提交，要求不少于300字。\n3. 整理课堂笔记\n暂无截止日期', now);
  assert.equal(tasks.length, 3);
  assert.match(tasks[0].title, /高等数学/);
  assert.match(tasks[0].details, /计算过程/);
  assert.equal(tasks[0].dueDate, '2026-10-30');
  assert.equal(tasks[1].dateConfirmed, true);
  assert.equal(tasks[1].dueDate, '2026-10-30');
  assert.equal(tasks[2].dateConfirmed, false);
});
test('retains a shared deadline in a numbered notice', () => {
  const tasks = extractTasks('以下作业请于周五截止前提交\n1. 数学习题\n2. 英语报告', now);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every(t => t.dateConfirmed && t.dueDate === '2026-10-30' && /共同说明/.test(t.details)));
});
test('unclassified text is still reviewable and empty text yields no tasks', () => {
  assert.equal(extractTasks('').length, 0);
  assert.equal(extractTasks('老师说要记得带尺子').length, 1);
});
test('date-only deadline is start of the selected day in UTC+8', () => {
  const task = sampleTask();
  assert.equal(new Date(dueTimestamp(task)).toISOString(), '2026-10-29T16:00:00.000Z');
  assert.equal(taskGroup(task, Date.parse('2026-10-29T16:00:00Z')), 'overdue');
  assert.equal(taskGroup(task, now.getTime()), 'scheduled');
});
test('only unfinished deadlines within the next 72 hours are upcoming', () => {
  const end = dueTimestamp(sampleTask());
  assert.equal(taskGroup(sampleTask(), end - 72 * 60 * 60 * 1000), 'upcoming');
  assert.equal(taskGroup(sampleTask(), end - 72 * 60 * 60 * 1000 - 1), 'scheduled');
  assert.equal(taskGroup(sampleTask(), end - 1), 'upcoming');
  assert.equal(taskGroup(sampleTask(), end), 'overdue');
  assert.equal(taskGroup(sampleTask({ completedAt: now.toISOString() }), end - 1), 'completed');
});
test('platform deadline overrides start time and weekday annotations do not trigger relative-date confirmation', () => {
  const text = '开始时间: 2026-10-23/11:09/星期五\n截止时间: 2026-10-31/23:59/星期六';
  const result = extractDeadline(text, now);
  assert.equal(result.dueDate, '2026-10-31');
  assert.equal(result.dueTime, '23:59');
  assert.equal(result.dateConfirmed, true);
  const relative = extractDeadline('开始时间：2026-10-23\n截止时间：周五23:59', now);
  assert.equal(relative.dateConfirmed, true);
  assert.equal(relative.dueDate, '2026-10-30');
  assert.equal(relative.dueTime, '23:59');
});

test('Saturday evening resolves tomorrow to Sunday midnight and Friday to the following week', () => {
  const saturday = new Date(2026, 9, 24, 20, 30);
  for (const [text, date] of [['明天提交', '2026-10-25'], ['后天交', '2026-10-26'], ['周五截止', '2026-10-30'], ['星期五交', '2026-10-30'], ['礼拜天提交', '2026-10-25']]) {
    const result = extractDeadline(text, saturday);
    assert.equal(result.dueDate, date, text);
    assert.equal(result.dueTime, '');
    assert.equal(result.dateConfirmed, true);
    assert.match(result.dateHint, /设备本地时间 2026-10-24 20:30/);
    assert.match(result.dateHint, /00:00/);
  }
});
test('bare weekdays roll forward only when the selected deadline has already passed', () => {
  const fridayMorning = new Date(2026, 9, 23, 10);
  assert.equal(extractDeadline('周五交', fridayMorning).dueDate, '2026-10-30');
  const today = extractDeadline('周五下午三点提交', fridayMorning);
  assert.equal(today.dueDate, '2026-10-23'); assert.equal(today.dueTime, '15:00');
  assert.equal(extractDeadline('周五下午三点提交', new Date(2026, 9, 23, 20)).dueDate, '2026-10-30');
  assert.equal(extractDeadline('本周五交', new Date(2026, 9, 24, 20)).dueDate, '2026-10-23');
  assert.equal(extractDeadline('下周五交', new Date(2026, 9, 25, 20)).dueDate, '2026-10-30');
  assert.equal(extractDeadline('下下周五交', new Date(2026, 9, 25, 20)).dueDate, '2026-11-06');
});
test('relative dates cross month ends, leap days and years without retaining the device clock time', () => {
  for (const [device, expression, expected] of [
    [new Date(2026, 11, 31, 23, 59), '明天', '2027-01-01'],
    [new Date(2026, 11, 31, 23, 59), '后天', '2027-01-02'],
    [new Date(2026, 1, 28, 23), '明天', '2026-03-01'],
    [new Date(2028, 1, 28, 23), '明天', '2028-02-29'],
    [new Date(2028, 1, 28, 23), '后天', '2028-03-01'],
  ]) {
    const result = extractDeadline(expression, device);
    assert.equal(result.dueDate, expected); assert.equal(result.dueTime, ''); assert.equal(result.dateConfirmed, true);
  }
});
test('relative dates use the device local calendar across DST rather than UTC or fixed-hour additions', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { extractDeadline } from './src/domain.js';
    const a = new Date(2026, 2, 7, 23, 30);
    const b = new Date('2026-10-25T02:30:00Z');
    console.log(JSON.stringify([extractDeadline('明天交', a).dueDate, extractDeadline('后天交', a).dueDate, extractDeadline('明天交', b).dueDate]));
  `], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), ['2026-03-08', '2026-03-09', '2026-10-25']);
});
test('relative dates retain explicit times and ignore preceding screenshot status clocks', () => {
  const device = new Date(2026, 9, 24, 20, 30);
  assert.equal(extractDeadline('后天晚上十一点五十九分交', device).dueTime, '23:59');
  assert.equal(extractDeadline('20:29\n完成数学作业\n明天提交', device).dueTime, '');
  assert.equal(extractDeadline('开始时间：2026-10-23/11:09\n截止时间：周五23:59', device).dueDate, '2026-10-30');
  const tasks = extractTasks('完成数学第三章习题\n明天提交', device);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].title, '完成数学第三章习题'); assert.equal(tasks[0].dueDate, '2026-10-25');
});
test('conflicting or unresolved relative expressions still ask for confirmation', () => {
  const device = new Date(2026, 9, 24, 20, 30);
  for (const text of ['明天或后天提交', '周五或周六交', '周末截止', '下周交', '三天内交', '明天25:61提交', '明天10月30日交']) assert.equal(extractDeadline(text, device).dateConfirmed, false, text);
  const consistent = extractDeadline('明天10月25日交', device);
  assert.equal(consistent.dueDate, '2026-10-25'); assert.equal(consistent.dateConfirmed, true);
});
test('a sparse exam details screen yields one real task, not UI headings', () => {
  const tasks = extractTasks('20:29\n考试\n第 六 章 作业\n—考试说明—\n暂无说明\n50\n试卷分数\n19\n题数\n开始 时 间: 2026-10-23/11:09/星 期 五\n截止 时 间: 2026-10-31/23:59/星 期 六\n考试限时：不限时\n继续答题', now);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, '第六章作业');
  assert.equal(tasks[0].dueDate, '2026-10-31');
  assert.equal(tasks[0].dueTime, '23:59');
  assert.ok(!tasks[0].details.includes('继续答题'));
  assert.ok(!tasks[0].details.includes('试卷分数'));
});
test('classifies completed and undated tasks and sorts chronologically', () => {
  assert.equal(taskGroup(sampleTask({ completedAt: now.toISOString() })), 'completed');
  assert.equal(taskGroup(sampleTask({ dueDate: '' })), 'undated');
  const a = sampleTask({ id: 'later', dueDate: '2026-11-01' });
  const b = sampleTask({ id: 'earlier' });
  const c = sampleTask({ id: 'none', dueDate: '' });
  assert.deepEqual(sortTasks([c, a, b]).map(t => t.id), ['earlier', 'later', 'none']);
});
test('finds exact and similar titles while allowing distinct short tasks', () => {
  const tasks = [sampleTask()];
  assert.equal(findDuplicates({ title: '高等数学 第三章习题！' }, tasks).length, 1);
  assert.equal(findDuplicates({ title: '完成高等数学第三章习题' }, tasks).length, 1);
  assert.equal(findDuplicates({ title: '高等数学第三章习题' }, tasks, 'fixture-1').length, 0);
  assert.equal(findDuplicates({ title: '英语阅读报告' }, tasks).length, 0);
});
test('validates task names, date and time combinations', () => {
  assert.match(validateTask({ title: '' }), /名称/);
  assert.match(validateTask({ title: '任务', dueTime: '12:00' }), /日期/);
  assert.match(validateTask({ title: '任务', dueDate: '2026-01-01', dueTime: '24:00' }), /时间/);
  assert.equal(validateTask(sampleTask()), '');
});
test('ICS uses UTC for China midnight and all four default alarms', () => {
  const calendar = createCalendar([sampleTask()], undefined, now);
  assert.match(calendar, /DTSTART:20261029T160000Z\r\n/);
  assert.match(calendar, /DTEND:20261029T160100Z\r\n/);
  for (const minutes of [4320, 1440, 300, 60]) assert.match(calendar, new RegExp(`TRIGGER:-PT${minutes}M\\r\\n`));
  assert.equal((calendar.match(/BEGIN:VALARM/g) || []).length, 4);
  assert.match(calendar, /SUMMARY:高等数学第三章习题/);
  assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
});
test('ICS excludes undated tasks, escapes text and deduplicates alarms', () => {
  const calendar = createCalendar([sampleTask({ title: '任务,一;二\\三\n四' }), sampleTask({ id: 'no-date', dueDate: '' })], [60, 60, -1], now);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((calendar.match(/BEGIN:VALARM/g) || []).length, 1);
  assert.ok(calendar.includes('SUMMARY:任务\\,一\\;二\\\\三\\n四'));
});
test('ICS folding is UTF-8 safe and every physical line is at most 75 bytes', () => {
  const line = `DESCRIPTION:${'中文测试🌱'.repeat(100)}`;
  const folded = foldLine(line);
  assert.equal(folded.replace(/\r\n /g, ''), line);
  assert.ok(folded.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
  assert.ok(createCalendar([sampleTask({ details: line })]).split('\r\n').every(l => Buffer.byteLength(l) <= 75));
});
test('ICS UID remains stable when task is edited', () => {
  const original = createCalendar([sampleTask()]);
  const edited = createCalendar([sampleTask({ title: '修改后的任务' })]);
  assert.equal(original.match(/UID:[^\r]+/)[0], edited.match(/UID:[^\r]+/)[0]);
});
test('backup validation accepts real data and rejects corrupt files atomically', () => {
  const json = tasks => JSON.stringify({ format: 'shike-backup', version: 1, tasks });
  assert.equal(parseBackup(json([sampleTask()]))[0].title, sampleTask().title);
  assert.throws(() => parseBackup('{}'));
  assert.throws(() => parseBackup(json([sampleTask(), sampleTask()])));
  assert.throws(() => parseBackup(json([sampleTask({ dueDate: '2026-02-30' })])));
  assert.throws(() => parseBackup(json([sampleTask({ createdAt: 'bad-date' })])));
  assert.throws(() => parseBackup(json([sampleTask({ details: {} })])));
});
