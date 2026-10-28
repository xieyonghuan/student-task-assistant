import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeks, formatWeeks, parseCourseList, parseTimetableLayout, dedupeCourses } from '../src/timetable-parse.js';

test('week ranges preserve odd/even and discontinuous weeks without inventing missing weeks', () => {
  assert.deepEqual(parseWeeks('1-8周(单),10-16周(双)'), [1,3,5,7,10,12,14,16]);
  assert.deepEqual(parseWeeks('第1—4周、8、10-12'),[1,2,3,4,8,10,11,12]);
  assert.deepEqual(parseWeeks(''), []);
  assert.equal(formatWeeks([1,2,3,6,8,9]),'1-3,6,8-9');
  for(const input of ['0-16','16-1','1-21','每周','1-16xxx','2(单)']) assert.throws(()=>parseWeeks(input,20));
});

test('structured course lists yield separate courses and retain multiple meetings of one course', () => {
  const text = '课程名称：运筹学\n教师：张老师\n周一 第1-2节\n周次：1-16(单)\n地点：教A201\n\n课程名称：大学英语\n周二 第3-4节\n周次：1-16\n教室：B102\n\n课程名称：运筹学\n周三 第5-6节\n周次：1-16(单)';
  const items=parseCourseList(text);assert.equal(items.length,3);
  assert.equal(items[0].name,'运筹学');assert.equal(items[0].day,1);assert.equal(items[0].start,1);assert.equal(items[0].end,2);
  assert.deepEqual(items[0].weeks,[1,3,5,7,9,11,13,15]);assert.equal(items[1].room,'B102');assert.equal(items[2].day,3);
});

test('course names alone remain unscheduled and week numbers cannot become period numbers',()=>{
  const names=parseCourseList('高等数学\n大学英语\n运筹学');assert.equal(names.length,3);assert.ok(names.every(c=>c.day===0&&c.start===0&&!c.weeks.length));
  const [course]=parseCourseList('课程名称：高等数学\n第1-16周');assert.equal(course.start,0);assert.equal(course.end,0);
  assert.deepEqual(parseCourseList('课程名称：大 学 英语\n教室：B102\n周三\n周次：2-16(双)\n节次：3-4')[0].weeks,[2,4,6,8,10,12,14,16]);
});

test('duplicate merging compares the entire meeting, not just the course name',()=>{
  const [a]=parseCourseList('课程名称：运筹学\n周一 第1-2节\n1-16周');
  assert.equal(dedupeCourses([a,structuredClone(a),{...a,day:3},{...a,weeks:[1,3]},{...a,room:'另一教室'}]).length,4);
});

const line=(text,x,y,w=80,h=18)=>({text,bbox:{x0:x,y0:y,x1:x+w,y1:y+h}});
function grid(){
  const lines=['一','二','三','四','五','六','日'].map((day,i)=>line(`周${day}`,100+i*120,20));
  lines.push(line('1-2节',5,85,40),line('3-4节',5,285,40),line('5-6节',5,485,40));
  lines.push(line('运筹学',100,85),line('1-16周(单)',100,110),line('教室：A201',100,135));
  lines.push(line('大学英语',220,285),line('1-16周',220,310),line('教室：B102',220,335));
  lines.push(line('高等数学',100,485),line('1-16周',100,510));
  return {lines,text:lines.map(l=>l.text).join('\n')};
}
test('grid coordinates preserve weekday columns, separate rows and paired periods',()=>{
  const result=parseTimetableLayout(grid());assert.equal(result.layout,'grid');assert.equal(result.items.length,3);
  const a=result.items.find(c=>c.name==='运筹学');assert.equal(a.day,1);assert.equal(a.start,1);assert.equal(a.end,2);assert.equal(a.room,'A201');
  const b=result.items.find(c=>c.name==='大学英语');assert.equal(b.day,2);assert.equal(b.start,3);assert.equal(b.end,4);
  assert.equal(result.items.find(c=>c.name==='高等数学').start,5);
});
test('forced grid mode refuses cropped/missing weekday headers instead of fabricating weekdays',()=>{
  const data=grid();data.lines=data.lines.filter(l=>!l.text.startsWith('周'));
  const result=parseTimetableLayout(data,'grid');assert.equal(result.items.length,0);assert.ok(result.warnings.length);
});
test('grid without week labels leaves course weeks empty for explicit confirmation',()=>{
  const data=grid();data.lines=data.lines.filter(l=>!l.text.includes('1-16周'));data.text=data.lines.map(l=>l.text).join('\n');
  assert.ok(parseTimetableLayout(data).items.every(c=>c.weeks.length===0));
});
test('list screenshot columns keep names, teacher, place and times on their own rows',()=>{
  const lines=[line('课程名称',10,10),line('教师',200,10),line('星期',350,10),line('周次',500,10),line('节次',650,10),line('教室',800,10),
    line('运筹学',10,80),line('张老师',200,80),line('一',350,80),line('1-16',500,80),line('1-2',650,80),line('A201',800,80),
    line('大学英语',10,180),line('李老师',200,180),line('三',350,180),line('2-16(双)',500,180),line('3-4',650,180),line('B102',800,180)];
  const result=parseTimetableLayout({lines,text:lines.map(l=>l.text).join('\n')});assert.equal(result.items.length,2);
  assert.equal(result.items[0].name,'运筹学');assert.equal(result.items[0].teacher,'张老师');assert.equal(result.items[0].day,1);
  assert.deepEqual(result.items[1].weeks,[2,4,6,8,10,12,14,16]);assert.equal(result.items[1].start,3);assert.equal(result.items[1].room,'B102');
});
