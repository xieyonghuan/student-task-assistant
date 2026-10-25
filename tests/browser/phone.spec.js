import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('Ace 3 sized portrait, landscape and enlarged display keep pages, forms and touch actions usable', async ({page})=>{
  for(const [width,height] of [[421,927],[393,864],[360,792],[927,421],[800,1280]]){
    await page.setViewportSize({width,height});
    await page.goto('./#/home');
    await page.reload();
    await expect(page.getByRole('heading',{name:'首页',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width<=650){
      expect(await page.locator('.sidebar nav .nav-item').evaluateAll(items=>items.every(el=>{const r=el.getBoundingClientRect();return r.width>=44 && r.height>=44;}))).toBe(true);
      expect(await page.locator('#home-manual').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#home-manual').click();
    await expect(page.locator('#task-form')).toBeVisible();
    const form=page.locator('#task-form');
    await form.locator('[name="title"]').fill('一加手机上的数学学习任务');
    await form.locator('[name="dueDate"]').fill('2026-12-30');
    await form.locator('[name="details"]').fill('较长的具体要求，在手机中需要完整显示，也能在键盘弹出后滚动检查并保存。'.repeat(4));
    await page.getByRole('button',{name:'保存任务',exact:true}).click();
    await expect(form).toHaveCount(0);
    await page.locator('.sidebar [data-view="all"]').click();
    await expect(page.locator('.task-card').first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width<=650){
      expect(await page.locator('.task-card').first().locator('.complete-button, .task-card-actions .icon-button').evaluateAll(items=>items.every(el=>{const r=el.getBoundingClientRect();return r.width>=44 && r.height>=44;}))).toBe(true);
      expect(await page.locator('.due-label').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    }
    if(width===421){await mkdir('../outputs',{recursive:true});await page.screenshot({path:'../outputs/shike-v1.2-ace3-timeline.png',fullPage:true});}
    // Each iteration deliberately restores a clean temporary browser database.
    await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('shike-study-tasks',1);r.onsuccess=()=>{const tx=r.result.transaction('tasks','readwrite');tx.objectStore('tasks').clear();tx.oncomplete=()=>{r.result.close();resolve()};tx.onerror=()=>reject(tx.error)}}));
  }
});

test('short phone keyboard viewport scrolls the form without losing input', async ({page})=>{
  await page.setViewportSize({width:421,height:927});await page.goto('./#/home');
  await page.locator('#home-manual').click();
  await page.locator('#task-form [name="details"]').fill('手机键盘弹出后也不能丢失的输入');
  await page.evaluate(()=>document.documentElement.classList.add('keyboard-open'));
  await page.setViewportSize({width:421,height:470});
  await expect(page.locator('#task-form [name="details"]')).toHaveValue('手机键盘弹出后也不能丢失的输入');
  const save=page.getByRole('button',{name:'保存任务',exact:true});await save.scrollIntoViewIfNeeded();
  expect(await save.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})).toBe(true);
  await page.setViewportSize({width:421,height:927});
  await page.evaluate(()=>document.documentElement.classList.remove('keyboard-open'));
  await expect(page.locator('#task-form [name="details"]')).toHaveValue('手机键盘弹出后也不能丢失的输入');
});
