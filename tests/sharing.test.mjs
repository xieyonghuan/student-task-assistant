import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTasks } from '../src/domain.js';
import { formatSharedTasks } from '../src/sharing.js';

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
  assert.match(tasks[1].details, /暂无截止日期/);
  assert.throws(() => formatSharedTasks([]), /至少/);
  assert.throws(() => formatSharedTasks([{ title: 'x', details: 'x'.repeat(100000) }]), /过长/);
});
