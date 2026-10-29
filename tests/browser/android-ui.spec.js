import {test,expect} from '@playwright/test';
async function android(page){await page.addInitScript(()=>{window.ShikeNative={postMessage(raw){const m=JSON.parse(raw);setTimeout(()=>ShikeNative.onmessage?.({data:JSON.stringify({id:m.id,ok:true,result:m.method==='shareInbox'?[]:{available:true,enabled:false,granted:false,supported:false}})}),0);}};});await page.goto('./#/home');}
test('four native destinations and compact home stay usable on phone and portrait tablet',async({page})=>{
 for(const [width,height] of [[393,851],[800,1280],[1280,800]]){await page.setViewportSize({width,height});await android(page);await expect(page.locator('.sidebar nav .nav-item')).toHaveCount(4);expect(await page.locator('.sidebar nav .nav-item>span:first-of-type').allTextContents()).toEqual(['首页','课程作业','课程表','我的']);await expect(page.getByRole('button',{name:'创建课程表',exact:true})).toBeInViewport();await expect(page.locator('#home-manual')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
test('assignment categories filter below four buttons and retain access to the complete timeline',async({page})=>{
 await android(page);await page.locator('.sidebar [data-view=all]').click();await expect(page.locator('.assignment-tabs button')).toHaveCount(4);await expect(page.locator('#task-list')).toBeVisible();
 for(const key of ['upcoming','overdue','undated','completed']){await page.locator('.assignment-tabs [data-view='+key+']').click();await expect(page.locator('.assignment-tab.selected')).toHaveCount(1);await expect(page.locator('.sidebar [data-view=all]')).toHaveAttribute('aria-current','page');await page.locator('.assignment-reset').click();}
});
test('my page provides settings and widget entry while tablet sidebar folding survives reload',async({page})=>{
 await page.setViewportSize({width:800,height:1280});await android(page);await page.locator('.sidebar [data-view=mine]').click();await expect(page.getByRole('button',{name:'添加桌面小组件'})).toBeVisible();await page.getByRole('button',{name:'添加桌面小组件'}).click();await expect(page.locator('#toast')).toContainText('长按桌面');await page.getByRole('button',{name:'设置与帮助 / 任务备份'}).click();await expect(page.getByRole('heading',{name:'你的本地学习空间'})).toBeVisible();await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await page.reload();await expect(page.getByRole('button',{name:'展开侧栏',exact:true})).toBeVisible();
});
test('moving among four destinations retains unfinished task input',async({page})=>{
 await android(page);await page.locator('#home-manual').click();await page.locator('#task-form [name=title]').fill('保留的作业草稿');await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await page.locator('.sidebar [data-view=mine]').click();await page.locator('.sidebar [data-view=home]').click();await expect(page.locator('.home-followup')).toContainText('恢复上次内容');
});
