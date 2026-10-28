import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSettings,regroupPeriods,validatePeriodGroups,remapPeriodRange,timeMinutes,minutesTime} from '../src/course-schedule.js';

test('legacy period times retain their day groups and custom durations without modifying the table',()=>{
  const table={periods:[{start:'08:00',end:'08:50'},{start:'14:00',end:'14:50'},{start:'19:00',end:'19:50'}]},before=structuredClone(table);
  assert.deepEqual(scheduleSettings(table),{periodGroups:{morning:1,afternoon:1,evening:1},lessonMinutes:50});assert.deepEqual(table,before);
  assert.equal(minutesTime(timeMinutes('8：5')+50),'08:55');assert.throws(()=>minutesTime(timeMinutes('23:30')+50));
});
test('changing morning count retains afternoon times and remaps arrangements instead of shifting courses to morning',()=>{
  const old={morning:2,afternoon:2,evening:0},next={morning:3,afternoon:2,evening:0};
  const periods=[{start:'08:00',end:'08:45'},{start:'09:00',end:'09:45'},{start:'14:00',end:'14:45'},{start:'15:00',end:'15:45'}];
  assert.deepEqual(regroupPeriods(periods,old,next),[...periods.slice(0,2),{start:'',end:''},...periods.slice(2)]);
  assert.deepEqual(remapPeriodRange(3,4,old,next),{start:4,end:5});assert.deepEqual(remapPeriodRange(0,0,old,next),{start:0,end:0});
  assert.throws(()=>remapPeriodRange(2,3,old,next),/连堂课/);assert.throws(()=>remapPeriodRange(3,4,old,{morning:2,afternoon:1,evening:0}),/仍有课程/);
  assert.throws(()=>validatePeriodGroups({morning:0,afternoon:0,evening:0}));assert.throws(()=>validatePeriodGroups({morning:10,afternoon:10,evening:1}));assert.throws(()=>validatePeriodGroups({morning:2.5,afternoon:0,evening:0}));
});
