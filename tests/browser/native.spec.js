import { test, expect } from '@playwright/test';

async function nativeApp(page) {
  await page.addInitScript(() => {
    window.__nativeCalls = [];
    window.__calendar = {available:true, enabled:false, granted:false};
    window.ShikeNative = { postMessage(raw) {
      const message = JSON.parse(raw); window.__nativeCalls.push(message);
      let result = window.__calendar, error;
      if (message.method === 'calendarEnable') {
        if (window.__denyCalendar) error = '日历权限未允许';
        else { window.__calendar.enabled = true; window.__calendar.granted = true; }
      } else if (message.method === 'calendarDisable') window.__calendar.enabled = false;
      else if (message.method === 'calendarSync') {
        if (window.__failSync) error = '日历权限已关闭';
        result = {enabled:window.__calendar.enabled};
      }
      setTimeout(() => window.ShikeNative.onmessage?.({data:JSON.stringify({id:message.id,ok:!error,result,error})}), 5);
    }};
  });
  await page.goto('./#/tasks');
  await expect(page.getByRole('heading', {name:'全部待办',exact:true})).toBeVisible();
}
async function add(page) {
  await page.getByRole('button', {name:'手动添加',exact:true}).click();
  await page.locator('#task-form [name="title"]').fill('数学第三章习题');
  await page.locator('#task-form [name="dueDate"]').fill('2026-10-30');
  await page.getByRole('button', {name:'保存任务',exact:true}).click();
  await expect(page.locator('#task-form')).toHaveCount(0);
}
async function snapshot(page) {
  return page.evaluate(() => window.__nativeCalls.filter(call=>call.method==='calendarSync').at(-1).args.tasks);
}
test('Android calendar permission is explicit, then save/edit/complete/restore/date removal/deletion synchronize', async ({page}) => {
  await nativeApp(page);
  expect(await page.evaluate(()=>window.__nativeCalls.some(call=>call.method==='calendarEnable'))).toBe(false);
  await page.getByRole('button',{name:'日历自动同步',exact:true}).click();
  await page.getByRole('button',{name:'授权并开启自动同步',exact:true}).click();
  await expect(page.locator('#calendar-status')).toContainText('自动同步已开启');
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await add(page);
  let tasks = await snapshot(page); const id = tasks[0].id;
  expect(tasks[0].begin).toBe(Date.parse('2026-10-30T00:00:00+08:00'));
  await page.getByRole('button',{name:'编辑任务：数学第三章习题',exact:true}).click();
  await page.locator('#task-form [name="title"]').fill('修改后的数学作业');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.locator('#task-form')).toHaveCount(0);
  expect((await snapshot(page))[0]).toMatchObject({id,title:'修改后的数学作业',completed:false});
  await page.getByRole('button',{name:'标为已完成：修改后的数学作业',exact:true}).click();
  await expect.poll(async ()=>(await snapshot(page))[0]?.completed).toBe(true);
  await page.locator('[data-view="completed"]').click();
  await page.getByRole('button',{name:'恢复任务：修改后的数学作业',exact:true}).click();
  await expect.poll(async ()=>(await snapshot(page))[0]?.completed).toBe(false);
  await page.locator('[data-view="all"]').click();
  await page.getByRole('button',{name:'编辑任务：修改后的数学作业',exact:true}).click();
  await page.locator('#task-form [name="dueDate"]').fill('');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.locator('#task-form')).toHaveCount(0);
  expect(await snapshot(page)).toEqual([]);
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.getByRole('button',{name:'删除任务：修改后的数学作业',exact:true}).click();
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(page.locator('.task-card')).toHaveCount(0);
});
test('denied calendar permission and failed sync preserve the task and offer a persistent retry', async ({page}) => {
  await nativeApp(page); await add(page);
  await page.evaluate(()=>{window.__denyCalendar=true;});
  await page.getByRole('button',{name:'日历自动同步',exact:true}).click();
  await page.getByRole('button',{name:'授权并开启自动同步',exact:true}).click();
  await expect(page.locator('#calendar-error')).toContainText('权限未允许');
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.evaluate(()=>{window.__failSync=true;});
  await page.getByRole('button',{name:'标为已完成：数学第三章习题',exact:true}).click();
  await expect(page.locator('.error-banner')).toContainText('任务已保存在拾课中');
  await page.evaluate(()=>{window.__failSync=false;window.__denyCalendar=false;});
  await page.getByRole('button',{name:'检查日历同步',exact:true}).click();
  await page.getByRole('button',{name:'授权并开启自动同步',exact:true}).click();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await page.locator('[data-view="completed"]').click();
  await expect(page.locator('.task-card')).toHaveCount(1);
});
