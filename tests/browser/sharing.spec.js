import { test, expect } from '@playwright/test';

async function app(page) {
  await page.addInitScript(() => {
    window.__inbox = []; window.__calls = []; window.__failAck = false;
    window.ShikeNative = { postMessage(raw) {
      const m = JSON.parse(raw); window.__calls.push(m);
      let result = { available: true, enabled: false, granted: false }, error;
      if (m.method === 'shareInbox') result = window.__inbox;
      if (m.method === 'readClipboard') result = { text: window.__clipboardText || '' };
      if (m.method === 'shareConsume') { if (window.__failAck) error = 'ack interrupted'; else window.__inbox = window.__inbox.filter(item => item.id !== m.args.id); }
      if (m.method === 'recognizeImage') result = window.__ocrResult || { text: '完成物理练习\n截止时间：2026年12月15日', engine: 'native-chinese' };
      setTimeout(() => ShikeNative.onmessage?.({ data: JSON.stringify({ id: m.id, ok: !error, result, error }) }), m.method === 'shareInbox' ? window.__inboxDelay || 5 : 5);
    } };
  });
  await page.goto('./#/home'); await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
}
async function deliver(page, item) {
  await page.evaluate(item => { window.__inbox.push(item); dispatchEvent(new Event('shike-share-ready')); }, item);
}
async function seed(page, records) {
  await page.evaluate(async records => {
    const db = await new Promise(resolve => { const r = indexedDB.open('shike-study-tasks'); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['drafts', 'tasks'], 'readwrite');
      for (const [store, record] of records) tx.objectStore(store).put(record);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  }, records);
}
const share = (id, text, images = []) => ({ id, text, images, receivedAt: Date.parse('2026-10-26T12:00:00+08:00') });

test('pasting two tasks over five unsaved tasks distinguishes new results from the preserved draft after reload', async ({ page }) => {
  await app(page);
  await seed(page,[['drafts',{id:'import',text:'旧通知',tasks:Array.from({length:5},(_,i)=>({id:'previous-'+i,title:'原有草稿'+i,details:'保留内容',selected:true})),sources:[],saved:0,skipped:0,stage:'review',accuracy:'fast'}]]);
  await page.evaluate(()=>{window.__clipboardText='拾课课程任务\n1. 数学报告\n截止时间：2026-12-30\n要求：写出步骤\n2. 英语阅读\n截止时间：2027-01-04\n要求：阅读章节';});
  await page.getByRole('button',{name:'接收 / 粘贴通知',exact:true}).click();
  await expect(page.locator('.batch-task')).toHaveCount(7);
  await expect(page.locator('#draft-origin-summary')).toContainText('本次导入 2 项 · 上次草稿 5 项');
  await expect(page.locator('.batch-select small').filter({hasText:'本次导入'})).toHaveCount(2);
  await expect(page.locator('.batch-select small').filter({hasText:'上次草稿'})).toHaveCount(5);
  await expect(page.locator('#ocr-accuracy')).toHaveValue('stable');
  await page.reload();
  await expect(page.locator('#draft-origin-summary')).toContainText('本次导入 2 项 · 上次草稿 5 项');
  await expect(page.locator('.batch-task [name=title]').first()).toHaveValue('原有草稿0');
  await expect(page.locator('.batch-task [name=details]').first()).toHaveValue('保留内容');
});

test('incoming share preserves existing import/manual drafts and durable receipt prevents duplicates after ack failure', async ({ page }) => {
  await app(page);
  await seed(page, [['drafts', { id: 'manual', task: { title: '尚未完成的手动任务' }, updatedAt: new Date().toISOString() }], ['drafts', { id: 'import', text: '完成化学习题', tasks: [{ id: 'old-task', title: '完成化学习题', details: '', dueDate: '', selected: true }], sources: [], saved: 0, skipped: 0, stage: 'review' }]]);
  await page.evaluate(() => { window.__failAck = true; });
  await deliver(page, share('11111111-1111-4111-8111-111111111111', '完成物理练习\n截止时间：2026年12月15日'));
  await expect(page.locator('.batch-task')).toHaveCount(2);
  await expect(page.locator('#toast')).toContainText('ack interrupted');
  await page.evaluate(() => { window.__failAck = false; dispatchEvent(new Event('shike-share-ready')); });
  await expect.poll(() => page.evaluate(() => window.__inbox.length)).toBe(0);
  await expect(page.locator('.batch-task')).toHaveCount(2);
  expect(await page.evaluate(() => new Promise(resolve => { const r = indexedDB.open('shike-study-tasks'); r.onsuccess = () => { const db = r.result, q = db.transaction('drafts').objectStore('drafts').get('manual'); q.onsuccess = () => { resolve(q.result.task.title); db.close(); }; }; }))).toBe('尚未完成的手动任务');
  await page.reload(); await expect(page.locator('.batch-task')).toHaveCount(2);
});

test('text and multiple shared images use stable OCR by default and preserve text source through refresh', async ({ page }) => {
  await app(page);
  const urls = ['/shared/22222222-2222-4222-8222-222222222222/1.img', '/shared/22222222-2222-4222-8222-222222222222/2.img'];
  const png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width=1200;c.height=350; const x = c.getContext('2d'); x.fillStyle = 'white'; x.fillRect(0, 0, c.width, c.height);x.fillStyle='#111';x.font='48px sans-serif';x.fillText('完成物理练习',40,90);x.fillText('截止时间：2026年12月15日',40,190); return c.toDataURL().split(',')[1]; }), 'base64');
  for (const url of urls) await page.route('**' + url, route => route.fulfill({ contentType: 'image/png', body: png }));
  await deliver(page, share('22222222-2222-4222-8222-222222222222', '完成英语阅读', urls.map((url, i) => ({ url: new URL(url, 'http://127.0.0.1:4173').href, name: `通知${i + 1}.png`, type: 'image/png' }))));
  await expect(page.locator('.batch-task')).toHaveCount(3);
  await expect(page.locator('#ocr-accuracy')).toHaveValue('stable');
  expect(await page.evaluate(() => window.__calls.filter(c => c.method === 'recognizeImage').length)).toBe(0);
  await expect(page.locator('.batch-task [name=title]').nth(1)).toHaveValue('完成物理练习');
  await expect(page.locator('#notification-text')).toHaveValue(/完成英语阅读/);
  await expect(page.locator('.batch-task').nth(1)).toContainText('重复');
  await page.reload(); await expect(page.locator('.batch-task')).toHaveCount(3);
  expect(await page.evaluate(() => window.__calls.filter(c => c.method === 'recognizeImage').length)).toBe(0);
});

test('single and selected course task sharing preview uses native chooser only after explicit click, fits phone and tablet', async ({ page }) => {
  await app(page);
  await seed(page, ['物理练习', '英语阅读'].map((title, index) => ['tasks', { id: String(index), title, details: '核对要求', dueDate: '2026-12-15', dueTime: '', createdAt: new Date().toISOString(), completedAt: null }]));
  await page.goto('./#/tasks'); await page.reload(); await expect(page.locator('.task-card')).toHaveCount(2);
  await page.getByRole('button', { name: '分享任务', exact: true }).click();
  await expect(page.locator('#share-preview')).toHaveValue(/物理练习[\s\S]*英语阅读/);
  await page.locator('[name=share-task]').last().uncheck();
  await expect(page.locator('#share-preview')).not.toHaveValue(/英语阅读/);
  expect(await page.evaluate(() => window.__calls.some(c => c.method === 'shareTasks'))).toBe(false);
  await page.getByRole('button', { name: '选择分享应用', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.method === 'shareTasks').length)).toBe(1);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  for (const [width, height] of [[390, 844], [800, 1280]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '分享任务', exact: true }).click();
    await expect(page.locator('#share-preview')).toHaveValue(/英语阅读/);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await page.getByRole('button', { name: '分享任务：物理练习', exact: true }).click();
    await expect(page.locator('#share-preview')).toHaveValue(/物理练习/);
    await expect(page.locator('#share-preview')).not.toHaveValue(/英语阅读/);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  }
});

test('consumed share does not resurrect a completed draft and an untrusted image URL stays unacknowledged', async ({ page }) => {
  await app(page);
  const item = share('33333333-3333-4333-8333-333333333333', '完成数学练习');
  await deliver(page, item);
  await expect(page.locator('#review-form')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__inbox.length)).toBe(0);
  await page.getByRole('button', { name: '暂无截止日期', exact: true }).click();
  await page.locator('#review-form').getByRole('button', { name: /保存/ }).click();
  await expect(page.locator('.review-done')).toBeVisible();
  await deliver(page, item);
  await expect.poll(() => page.evaluate(() => window.__inbox.length)).toBe(0);
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible();
  await deliver(page, share('44444444-4444-4444-8444-444444444444', '', [{ url: 'https://example.com/untrusted.png', type: 'image/png' }]));
  await expect(page.locator('#toast')).toContainText('分享图片地址无效');
  expect(await page.evaluate(() => window.__inbox.length)).toBe(1);
  expect(await page.evaluate(() => window.__calls.some(c => c.method === 'shareConsume' && c.args.id.startsWith('44444444')))).toBe(false);
});

test('native text is independently checked on small title and date crops without reprocessing the full image', async ({ page }) => {
  await app(page);
  const image = await page.evaluate(() => {
    window.__ocrResult = { text: '完成教学第三章习题\n截止时间：2026年12月30日 23:59', engine: 'native-chinese', width: 1400, height: 450, regions: [
      { text: '完成教学第三章习题', left: 55, top: 40, right: 700, bottom: 100 },
      { text: '截止时间：2026年12月30日 23:59', left: 55, top: 140, right: 1100, bottom: 200 },
    ] };
    window.__sizes = [];
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...args) { window.__sizes.push([this.width, this.height]); return original.apply(this, args); };
    const c = document.createElement('canvas'); c.width = 1400; c.height = 450;
    const x = c.getContext('2d'); x.fillStyle = 'white'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111'; x.font = '48px "Microsoft YaHei"';
    x.fillText('完成数学第三章习题', 60, 90); x.fillText('截止时间：2026年12月30日 23:59', 60, 190);
    return c.toDataURL().split(',')[1];
  });
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await page.locator('#ocr-accuracy').selectOption('accurate');
  await page.locator('#screenshot-file').setInputFiles({ name: 'native-correction.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#review-form [name=title]')).toHaveValue('完成数学第三章习题');
  await expect(page.locator('#review-form [name=dueDate]')).toHaveValue('2026-12-30');
  const sizes = await page.evaluate(() => window.__sizes);
  expect(sizes).toHaveLength(2); expect(sizes.every(([w, h]) => w < 1200 && h < 120)).toBe(true);
});

test('copied text is pasted by the receive button, extracts the course and recalculates next Monday from the notice date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T18:00:00+08:00') });
  await app(page);
  await page.evaluate(() => { window.__clipboardText = '统计学课程群(88)\n作业_2.统计学简介-练习.pdf\n这是第二次作业，请完成练习\n下周一收齐提交\n@所有人'; });
  await page.getByRole('button', { name: '接收 / 粘贴通知', exact: true }).click();
  await expect(page.locator('#review-form [name=course]')).toHaveValue('统计学');
  await expect(page.locator('#review-form [name=dueDate]')).toHaveValue('2026-11-02');
  await page.locator('#notice-date').fill('2026-10-23');
  await page.getByRole('button', { name: '重算相对截止日期', exact: true }).click();
  await expect(page.locator('#review-form [name=dueDate]')).toHaveValue('2026-10-26');
  await page.locator('#review-form [name=course]').fill('统计学课程');
  await page.reload();
  await expect(page.locator('#review-form [name=course]')).toHaveValue('统计学课程');
  await expect(page.locator('#review-form [name=dueDate]')).toHaveValue('2026-10-26');
});

test('empty or unavailable clipboard offers an editable paste field instead of telling the user to share again', async ({ page }) => {
  await app(page);
  await page.getByRole('button', { name: '接收 / 粘贴通知', exact: true }).click();
  await page.locator('#paste-notice').fill('课程：物理\n完成物理练习\n截止时间：2026年12月30日');
  await page.getByRole('button', { name: '提取任务', exact: true }).click();
  await expect(page.locator('#review-form [name=course]')).toHaveValue('物理');
  await expect(page.locator('#review-form [name=dueDate]')).toHaveValue('2026-12-30');
});

test('a paste click during an automatic inbox check is retained and reads the clipboard once', async ({ page }) => {
  await app(page);
  await page.evaluate(() => { window.__clipboardText='课程：统计学\n完成统计学习题\n截止时间：2026年12月30日';window.__inboxDelay=600;dispatchEvent(new Event('shike-share-ready')); });
  await page.getByRole('button',{name:'接收 / 粘贴通知',exact:true}).click();
  await expect(page.locator('#review-form [name=course]')).toHaveValue('统计学');
  expect(await page.evaluate(()=>window.__calls.filter(call=>call.method==='readClipboard').length)).toBe(1);
});

for (const mode of ['clipboard', 'image']) test(`shared card via ${mode} keeps two tasks once with separate outer deadlines`, async ({ page }) => {
  await app(page);
  const image = await page.evaluate(() => {
    const text='拾课 · 课程任务\n1. 第三章练习\n截止时间：2026-12-3023:59\n要求：第三章练习\n开始时间：2026-12-01/11:09\n截止时间：2026-12-30/23:59\n考试限时：不限时\n2. 概率报告\n截止日期：2027-01-04\n要求：下周一提交报告\n使用完整的纸张';
    window.__clipboardText=text; window.__ocrResult={text,engine:'native-chinese'};
    const c=document.createElement('canvas');c.width=c.height=100;return c.toDataURL().split(',')[1];
  });
  if(mode==='clipboard') await page.getByRole('button',{name:'接收 / 粘贴通知',exact:true}).click();
  else {
    await page.getByRole('button',{name:/识别课程截图/}).click();
    await page.locator('#ocr-accuracy').selectOption('fast');
    await page.locator('#screenshot-file').setInputFiles({name:'card.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  }
  const titles=page.locator('#review-panel [name=title]');
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(0)).toHaveValue('第三章练习');await expect(titles.nth(1)).toHaveValue('概率报告');
  await expect(page.locator('#review-panel [name=dueDate]').nth(0)).toHaveValue('2026-12-30');
  await expect(page.locator('#review-panel [name=dueTime]').nth(0)).toHaveValue('23:59');
  await expect(page.locator('#review-panel [name=dueDate]').nth(1)).toHaveValue('2027-01-04');
  await expect(page.locator('#review-panel [name=details]').nth(1)).toHaveValue('下周一提交报告\n使用完整的纸张');
});

test('fast mode skips the second OCR engine even when native results include verification regions', async ({ page }) => {
  await app(page);
  const image = await page.evaluate(() => {
    window.__workers = 0; const Worker = window.Worker;
    window.Worker = class extends Worker { constructor(...args) { super(...args); window.__workers++; } };
    window.__ocrResult = { text: '课程：物理\n完成物理练习\n截止时间：2026年12月30日', engine: 'native-chinese', width:100,height:100,regions:[{text:'完成物理练习',left:0,top:0,right:100,bottom:100}] };
    const c = document.createElement('canvas'); c.width = c.height = 100; return c.toDataURL().split(',')[1];
  });
  await page.getByRole('button', { name: /识别课程截图/ }).click();
  await expect(page.locator('#ocr-accuracy')).toHaveValue('stable');
  await page.locator('#ocr-accuracy').selectOption('fast');
  await page.locator('#screenshot-file').setInputFiles({name:'fast.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await expect(page.locator('#review-form [name=dueDate]')).toHaveValue('2026-12-30');
  expect(await page.evaluate(()=>window.__workers)).toBe(0);
  expect(await page.evaluate(()=>window.__calls.find(call=>call.method==='recognizeImage').args.accuracy)).toBe('fast');
});

test('task image cards are previewed and shared as PNG, and changing selected tasks invalidates the old image', async ({ page }) => {
  await app(page);
  await seed(page, ['物理练习', '英语阅读'].map((title,index)=>['tasks',{id:String(index),title,course:index?'英语':'物理',details:'完成题目并写出步骤。',dueDate:'2026-12-30',dueTime:'18:30',createdAt:new Date().toISOString()}]));
  await page.goto('./#/tasks'); await page.reload();
  await page.getByRole('button',{name:'分享任务',exact:true}).click();
  await page.getByRole('button',{name:'预览图片卡片',exact:true}).click();
  await expect(page.locator('#share-card-preview')).toBeVisible();
  expect(await page.locator('#share-card-preview').evaluate(image=>image.naturalWidth)).toBe(960);
  await page.getByRole('button',{name:'分享图片卡片',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__calls.filter(call=>call.method==='shareTaskImage').length)).toBe(1);
  const content=await page.evaluate(()=>window.__calls.find(call=>call.method==='shareTaskImage').args.content);
  expect(Buffer.from(content,'base64').subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  await page.locator('[name=share-task]').last().uncheck();
  await expect(page.locator('#share-card-wrap')).toBeHidden();
  await page.getByRole('button',{name:'预览图片卡片',exact:true}).click();
  await expect(page.locator('#share-card-preview')).toBeVisible();
  await page.setViewportSize({width:393,height:864});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
