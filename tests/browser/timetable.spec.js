import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const fixture = () => ({schema:1,revision:0,primaryId:'',reminders:false,leadMinutes:10,tables:[{id:'fixture-table',name:'秋季课表',firstMonday:'2026-10-26',maxWeeks:20,periods:[{start:'08:00',end:'08:45'},{start:'08:55',end:'09:40'},{start:'10:00',end:'10:45'},{start:'10:55',end:'11:40'}],courses:[{id:'fixture-course',name:'运筹学',teacher:'张老师',room:'A201',day:1,start:1,end:2,weeks:[1,3,5],notes:''}],changes:[]}]});
async function app(page, seed=fixture()) {
  await page.addInitScript(seed=>{
    window.__courseState=JSON.parse(localStorage.getItem('course-test-state')||'null')||seed;
    window.__courseCalls=[];
    window.ShikeNative={postMessage(raw){
      const m=JSON.parse(raw);window.__courseCalls.push(m);let result={available:true,enabled:false,granted:false},error;
      const state=window.__courseState;
      if(m.method==='shareInbox')result=[];
      if(m.method==='courseOpenTarget')result={};
      if(m.method==='coursePickTime')result={time:'08:10'};
      if(m.method==='courseLoad')result=state;
      if(m.method==='courseSave'){
        if(window.__failCourseSave)error='课表刚刚发生变化，请重新打开后再保存。';
        else {window.__courseState={...m.args.state,revision:state.revision+1};localStorage.setItem('course-test-state',JSON.stringify(window.__courseState));result=window.__courseState;}
      }
      if(m.method==='courseReminderStatus'||m.method==='courseNotificationPermission')result={granted:false,exact:false,scheduled:0,error:''};
      if(m.method==='courseWeek'){
        const table=state.tables.find(t=>t.id===m.args.tableId);const occurrences=[];
        for(const c of table?.courses||[]){if(!c.day||!c.start||!c.weeks.length)continue;
          const date=new Date(`${m.args.from}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+c.day-1);const originalDate=date.toISOString().slice(0,10);
          const week=Math.floor((Date.parse(m.args.from)-Date.parse(table.firstMonday))/604800000)+1;if(!c.weeks.includes(week))continue;
          const change=table.changes.find(x=>x.courseId===c.id&&x.date===originalDate);if(change?.type==='cancel')continue;
          occurrences.push({...c,courseId:c.id,tableId:table.id,key:`${table.id}/${c.id}/${originalDate}`,date:change?.targetDate||originalDate,originalDate,start:change?.start||c.start,end:change?.end||c.end,room:change?.room||c.room,changed:!!change,begin:Date.parse(`${originalDate}T08:00:00+08:00`),finish:Date.parse(`${originalDate}T09:40:00+08:00`)});
        }
        result={occurrences};
      }
      setTimeout(()=>ShikeNative.onmessage?.({data:JSON.stringify({id:m.id,ok:!error,result,error})}),0);
    }};
  },seed);
  await page.goto('./#/timetable');
  await expect(page.getByRole('heading',{name:'课程表',exact:true})).toBeVisible();
  await expect(page.locator('.course-toolbar')).toBeVisible();
}
async function add(page,name='高等数学'){
  await page.getByRole('button',{name:'添加课程',exact:true}).click();
  const dialog=page.locator('dialog[open]').last();await dialog.locator('[name=name]').fill(name);await dialog.locator('[name=weeks]').fill('1-16(单)');
  await dialog.getByRole('button',{name:'保存课程',exact:true}).click();await expect(dialog).toHaveCount(0);
}
test('new timetable, manual courses, copy, independent viewing and reminder source survive reload',async({page})=>{
  await app(page,{schema:1,revision:0,primaryId:'',reminders:false,leadMinutes:10,tables:[]});
  await page.getByRole('button',{name:'创建第一份课表'}).click();let d=page.locator('dialog[open]').last();
  await d.locator('[name=name]').fill('大二秋季');await d.locator('[name=firstMonday]').fill('2026-10-26');await d.locator('[name=periodCount]').selectOption('4');await d.getByRole('button',{name:'下一步：设置作息'}).click();await d.getByRole('button',{name:'保存课表'}).click();
  await expect(page.locator('.course-grid')).toBeVisible();await add(page);
  await page.getByRole('button',{name:'上课提醒',exact:true}).click();d=page.locator('dialog[open]').last();
  const primary=await page.evaluate(()=>window.__courseState.tables[0].id);await d.locator('[name=primaryId]').selectOption(primary);await d.getByLabel('开启上课提醒').check();
  await d.getByRole('button',{name:'保存提醒设置'}).click();await expect(page.locator('.course-reminder-summary')).toContainText('通知权限未开启');
  await page.getByRole('button',{name:'管理课表'}).click();await page.getByRole('button',{name:'复制这份课表'}).click();
  await expect(page.locator('#course-table-select')).not.toHaveValue(primary);
  expect(await page.evaluate(()=>window.__courseState.primaryId)).toBe(primary);
  await page.reload();await expect(page.locator('.course-row')).toHaveCount(1);
  const snapshot=await page.evaluate(()=>window.__courseState);expect(snapshot.tables[0].courses[0].id).not.toBe(snapshot.tables[1].courses[0].id);
  expect(snapshot.tables[0].courses[0].weeks).toEqual([1,3,5,7,9,11,13,15]);
});
test('one occurrence can move, cancel and undo without editing the semester rule',async({page})=>{
  await app(page);await page.locator('.course-block').first().click();let d=page.locator('dialog[open]').last();
  await d.locator('[name=targetDate]').fill('2026-10-28');await d.locator('[name=room]').fill('B102');await d.getByRole('button',{name:'保存本次变更'}).click();
  await expect(page.locator('.course-changes')).toContainText('2026-10-28');await expect(page.locator('.course-block')).toContainText('B102');
  expect(await page.evaluate(()=>window.__courseState.tables[0].courses[0].day)).toBe(1);
  await page.locator('.course-block').first().click();d=page.locator('dialog[open]').last();await d.locator('[name=type]').selectOption('cancel');await d.getByRole('button',{name:'保存本次变更'}).click();
  await expect(page.locator('.course-block')).toHaveCount(0);await expect(page.locator('.course-changes')).toContainText('停课');
  await page.locator('.course-all>summary').click();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('.course-block')).toHaveCount(1);await expect(page.locator('.course-block')).toContainText('A201');
});
test('save failure keeps the editor and existing course data available',async({page})=>{
  await app(page);await page.evaluate(()=>window.__failCourseSave=true);
  await page.locator('.course-all>summary').click();await page.locator('.course-row').first().click();const d=page.locator('dialog[open]').last();await d.locator('[name=name]').fill('修改后的课程');await d.getByRole('button',{name:'保存课程',exact:true}).click();
  await expect(d.locator('[role=alert]')).toContainText('刚刚发生变化');await expect(d.locator('[name=name]')).toHaveValue('修改后的课程');
  expect(await page.evaluate(()=>window.__courseState.tables[0].courses[0].name)).toBe('运筹学');
});
test('phone and portrait tablet contain horizontal scrolling within the timetable and keep overlapping courses accessible',async({page})=>{
  const state=fixture();state.tables[0].courses.push({...state.tables[0].courses[0],id:'conflict',name:'重叠课程'});await app(page,state);
  for(const [width,height] of [[393,851],[800,1280],[1280,800]]){
    await page.setViewportSize({width,height});await expect(page.locator('.course-block')).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const boxes=await page.locator('.course-block').evaluateAll(items=>items.map(e=>e.getBoundingClientRect().toJSON()));expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left+1);
    await expect(page.locator('[data-action=settings]')).toHaveCount(0);
  }
  await mkdir('../outputs',{recursive:true});await page.setViewportSize({width:800,height:1280});await page.screenshot({path:'../outputs/v200-tablet-timetable.png',fullPage:true});
  await page.setViewportSize({width:393,height:851});await page.screenshot({path:'../outputs/v200-phone-timetable.png',fullPage:true});
});
async function uploadList(page){
  await page.getByRole('button',{name:'识别课表截图',exact:true}).first().click();
  await page.locator('#course-import-mode').selectOption('list');
  await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1600;c.height=1000;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='42px sans-serif';
    ['课程名称：运筹学','周一 第1-2节','周次：1-16','教室：A201','','课程名称：大学英语','周二 第3-4节','周次：1-16','教室：B102'].forEach((line,i)=>x.fillText(line,60,80+i*85));
    c.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'课程列表.png',{type:'image/png'}));const input=document.querySelector('#course-images');input.files=dt.files;input.dispatchEvent(new Event('change'));});
  });
  await expect(page.locator('.course-review-progress')).toContainText('第 1 / 2 门课程',{timeout:180000});
}
test('real offline OCR list goes through editable draft recovery, duplicate confirmation and automatic cleanup',async({page})=>{
  const state=fixture();state.tables[0].courses=[];await app(page,state);await uploadList(page);
  await expect(page.locator('.course-candidates fieldset')).toHaveCount(1);
  await expect(page.locator('.course-candidates [name=name]').first()).toHaveValue('运筹学');
  await page.reload();await expect(page.locator('.course-toolbar')).toBeVisible();await page.getByRole('button',{name:'识别课表截图',exact:true}).first().click();
  await expect(page.locator('.course-review-progress')).toContainText('第 1 / 2 门课程');
  // Selecting an additional duplicate screenshot will be merged only at explicit save.
  await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('shike-course-drafts');r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),q=store.get('import');q.onsuccess=()=>{const draft=q.result;draft.sources.push({...draft.sources[0],id:'duplicate-image',name:'重复截图.png'});store.put(draft,'import');};tx.oncomplete=()=>{db.close();resolve();};};}));
  await page.reload();await expect(page.locator('.course-toolbar')).toBeVisible();await page.getByRole('button',{name:'识别课表截图',exact:true}).first().click();
  await expect(page.locator('.course-candidates fieldset')).toHaveCount(1);await expect(page.locator('.course-review-progress')).toContainText('第 1 / 2 门课程');await page.getByRole('button',{name:'确认并下一门'}).click();await expect(page.locator('.course-review-progress')).toContainText('第 2 / 2 门课程');await page.getByRole('button',{name:'确认并保存课程'}).click();
  await expect(page.locator('.course-row')).toHaveCount(2);await expect(page.locator('#toast')).toContainText('已保存 2 个上课安排');
  await page.getByRole('button',{name:'识别课表截图',exact:true}).first().click();await expect(page.locator('.course-candidates fieldset')).toHaveCount(0);
});
test('real offline grid OCR preserves columns and returns two editable course arrangements',async({page})=>{
  const state=fixture();state.tables[0].courses=[];await app(page,state);await page.getByRole('button',{name:'识别课表截图',exact:true}).first().click();await page.locator('#course-import-mode').selectOption('grid');
  await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=2000;c.height=1100;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='36px sans-serif';
    ['一','二','三','四','五','六','日'].forEach((day,i)=>x.fillText(`周${day}`,180+i*250,80));
    x.font='30px sans-serif';x.fillText('1-2节',20,230);x.fillText('3-4节',20,530);x.fillText('5-6节',20,830);
    x.font='36px sans-serif';x.fillText('运筹学',180,230);x.fillText('1-16周',180,290);x.fillText('教室：A201',180,350);
    x.fillText('大学英语',430,530);x.fillText('1-16周',430,590);x.fillText('教室：B102',430,650);
    c.toBlob(blob=>{const dt=new DataTransfer();dt.items.add(new File([blob],'周课表.png',{type:'image/png'}));const input=document.querySelector('#course-images');input.files=dt.files;input.dispatchEvent(new Event('change'));});
  });
  await expect(page.locator('.course-review-progress')).toContainText('第 1 / 2 门课程',{timeout:180000});
  await expect(page.locator('.course-candidates [name=name]')).toHaveValue('运筹学');await expect(page.locator('.course-candidates [name=day]')).toHaveValue('1');
  await expect(page.locator('.course-candidates [name=start]').first()).toHaveValue('1');
  await page.getByRole('button',{name:'确认并下一门'}).click();await expect(page.locator('.course-candidates [name=name]')).toHaveValue('大学英语');await expect(page.locator('.course-candidates [name=day]')).toHaveValue('2');
});

test('period count precedes paged per-period times and supports manual entry and native selection',async({page})=>{
  await page.setViewportSize({width:393,height:851});await app(page);await page.getByRole('button',{name:'新建课表',exact:true}).click();const d=page.locator('dialog[open]').last();
  await expect(d.locator('textarea')).toHaveCount(0);await d.locator('[name=firstMonday]').fill('2026-10-26');await d.locator('[name=periodCount]').selectOption('8');await d.getByRole('button',{name:'下一步：设置作息'}).click();
  await expect(d.locator('.period-row')).toHaveCount(4);await d.getByRole('button',{name:'选择第1节上课时间',exact:true}).click();await expect(d.getByLabel('第1节上课时间',{exact:true})).toHaveValue('08:10');await d.getByLabel('第1节下课时间',{exact:true}).fill('08:50');
  await d.getByRole('button',{name:'下一组',exact:true}).click();await expect(d.locator('#period-page-label')).toContainText('第 5—8 节');await d.getByRole('button',{name:'上一组',exact:true}).click();await expect(d.getByLabel('第1节下课时间',{exact:true})).toHaveValue('08:50');
  await d.getByRole('button',{name:'下一组',exact:true}).click();await d.getByRole('button',{name:'保存课表',exact:true}).click();await expect(d).toHaveCount(0);
  const saved=await page.evaluate(()=>window.__courseState.tables.at(-1));expect(saved.periods).toHaveLength(8);expect(saved.periods[0]).toEqual({start:'08:10',end:'08:50'});
});

const privateImages=Array.from({length:7},(_,i)=>path.resolve(`tests/fixtures/local/imust/screen-${i+1}.png`));
test('private seven screenshots produce eleven courses, preserve all meetings and confirm one course per screen',async({page})=>{
  test.skip(!privateImages.every(existsSync),'Private screenshots stay local and are not committed.');
  test.setTimeout(240000);const state=fixture();state.tables[0].courses=[];state.tables[0].periods=Array.from({length:12},(_,i)=>({start:`${String(6+i).padStart(2,'0')}:00`,end:`${String(6+i).padStart(2,'0')}:45`}));
  await page.setViewportSize({width:393,height:851});await app(page,state);await page.getByRole('button',{name:'识别课表截图',exact:true}).first().click();await page.locator('#course-images').setInputFiles(privateImages);
  await expect(page.locator('.course-review-progress')).toContainText('第 1 / 11 门课程',{timeout:180000});await expect(page.locator('.course-review-progress')).toContainText('34 个上课安排');
  await expect(page.locator('.course-candidates fieldset')).toHaveCount(1);await expect(page.locator('#course-confirm-next')).toBeInViewport();
  const first=await page.locator('.course-candidates [name=name]').inputValue();await page.locator('.course-candidates [name=teacher]').fill('本机核对后教师');
  await page.reload();await expect(page.locator('.course-toolbar')).toBeVisible();await page.getByRole('button',{name:'识别课表截图',exact:true}).first().click();await expect(page.locator('.course-candidates [name=name]')).toHaveValue(first);await expect(page.locator('.course-candidates [name=teacher]')).toHaveValue('本机核对后教师');
  for(let i=0;i<10;i++){await expect(page.locator('.course-candidates fieldset')).toHaveCount(1);await expect(page.locator('#course-confirm-next')).toBeInViewport();await page.getByRole('button',{name:'确认并下一门'}).click();await expect(page.locator('.course-review-progress')).toContainText(`第 ${i+2} / 11 门课程`);}
  await page.getByRole('button',{name:'确认并保存课程',exact:true}).click();await expect(page.locator('.course-row')).toHaveCount(34);
  const courses=await page.evaluate(()=>window.__courseState.tables[0].courses);expect(new Set(courses.map(c=>c.name)).size).toBe(11);expect(courses.filter(c=>c.day&&c.start&&c.weeks.length)).toHaveLength(33);
  expect(courses.find(c=>c.name==='中国书法艺术').day).toBe(0);expect(courses.filter(c=>c.name==='金工实习B')).toHaveLength(9);expect(courses.filter(c=>c.name==='运筹学')).toHaveLength(3);
  const micro=courses.find(c=>c.name==='微型计算机控制技术实践');expect(micro.weeks).toEqual([13,14]);expect(micro.day).toBe(7);expect(micro.start).toBe(9);
});
