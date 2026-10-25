import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarSnapshot, syncCalendar } from '../src/calendar-sync.js';
test('native calendar snapshot omits undated tasks, preserves IDs and completion and uses China midnight', () => {
  const tasks = [{id:'one', title:'数学作业', dueDate:'2026-10-30', dueTime:'', details:'写过程', completedAt:null},
    {id:'none', title:'阅读', dueDate:''}, {id:'done', title:'英语', dueDate:'2026-10-31', dueTime:'23:59', completedAt:'2026-10-24T00:00:00Z'}];
  const snapshot = calendarSnapshot(tasks);
  assert.equal(snapshot.length, 2); assert.equal(snapshot[0].id, 'one');
  assert.equal(snapshot[0].begin, Date.parse('2026-10-30T00:00:00+08:00'));
  assert.equal(snapshot[0].dateOnly, true); assert.equal(snapshot[1].completed, true);
  assert.equal(snapshot[1].begin, Date.parse('2026-10-31T23:59:00+08:00'));
});
test('regular web app never tries to access native calendar permissions', async () => {
  assert.deepEqual(await syncCalendar([]), {enabled:false});
});
