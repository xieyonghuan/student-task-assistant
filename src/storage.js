import { sanitizeTask, validateTask } from './domain.js';

let pendingDB;
function database() {
  if (!pendingDB) pendingDB = new Promise((resolve, reject) => {
    const request = indexedDB.open('shike-study-tasks', 2);
    // v1 tasks are kept intact. v2 adds local, temporary draft metadata and blobs.
    request.onupgradeneeded = () => {
      for (const name of ['tasks', 'drafts', 'draft-files']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); pendingDB = null; };
      resolve(request.result);
    };
    request.onerror = () => { pendingDB = null; reject(request.error); };
    request.onblocked = () => reject(new Error('请关闭其他拾课页面后重试。'));
  });
  return pendingDB;
}

async function transaction(mode, action, names = ['tasks']) {
  const db = await database();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(names, mode, mode === 'readwrite' ? { durability: 'strict' } : {}); }
    catch (error) { if (error instanceof TypeError) tx = db.transaction(names, mode); else throw error; }
    let value;
    try {
      const req = action(tx.objectStore(names[0]), tx);
      if (req) req.onsuccess = () => { value = req.result; };
    } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('本地存储写入失败，请检查可用空间。'));
    tx.onabort = () => reject(tx.error || new Error('保存中断，请重试。'));
  });
}

export const loadTasks = () => transaction('readonly', store => store.getAll());
export const putTask = task => transaction('readwrite', store => store.put(task));
export const deleteTask = id => transaction('readwrite', store => store.delete(id));
export const loadDraft = id => transaction('readonly', store => store.get(id), ['drafts']);
export const loadDraftFile = id => transaction('readonly', store => store.get(id), ['draft-files']);
export const putDraft = draft => transaction('readwrite', store => store.put(draft), ['drafts']);
export const deleteDraft = id => transaction('readwrite', (store, tx) => {
  store.delete(id);
  if (id === 'import') tx.objectStore('draft-files').clear();
}, ['drafts', 'draft-files']);
export const replaceImportDraft = (draft, files) => transaction('readwrite', (store, tx) => {
  const images = tx.objectStore('draft-files');
  images.clear();
  for (const file of files) images.put(file);
  store.put(draft);
}, ['drafts', 'draft-files']);
export async function appendSharedDraft(shareId, incoming, files) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['drafts', 'draft-files'], 'readwrite', { durability: 'strict' });
    const drafts = tx.objectStore('drafts'); let draft, receipt, error, duplicate = false;
    const a = drafts.get('import'), b = drafts.get('share-receipts');
    const c = tx.objectStore('draft-files').getAll(); let existingBytes = 0;
    let ready = 0;
    function commit() {
      if (++ready !== 3) return;
      receipt ||= { id: 'share-receipts', ids: [] };
      if (receipt.ids.includes(shareId)) { duplicate = true; return; }
      draft ||= { id: 'import', text: '', tasks: [], sources: [], saved: 0, skipped: 0, mode: 'image', referenceTime: incoming.referenceTime };
      if (draft.sources.length + incoming.sources.length > 20 || draft.text.length + incoming.text.length > 100000 || draft.tasks.length + incoming.tasks.length > 500 || existingBytes + files.reduce((sum, file) => sum + file.blob.size, 0) > 100 * 1024 * 1024) {
        error = new Error('当前草稿较多，请先完成或放弃这批通知，再从首页“接收分享”继续。分享仍在本机保留。'); tx.abort(); return;
      }
      const sourceText = draft.sources.filter(source => source.status === 'done').map(source => source.text).join('\n\n');
      if (draft.extraText === undefined || draft.text !== [draft.extraText, sourceText].filter(Boolean).join('\n\n')) draft.extraText = draft.text === sourceText ? '' : draft.text;
      draft.extraText = [draft.extraText, incoming.text].filter(Boolean).join('\n\n');
      draft.text = [draft.text, incoming.text].filter(Boolean).join('\n\n');
      draft.sources.push(...incoming.sources); draft.tasks.push(...incoming.tasks);
      draft.stage = 'review'; draft.overview = draft.sources.length > 1 || draft.tasks.length > 1; draft.updatedAt = new Date().toISOString();
      for (const file of files) tx.objectStore('draft-files').put(file);
      drafts.put(draft); receipt.ids.push(shareId); receipt.ids = receipt.ids.slice(-1024); drafts.put(receipt);
    }
    a.onsuccess = () => { draft = a.result; commit(); }; b.onsuccess = () => { receipt = b.result; commit(); };
    c.onsuccess = () => { existingBytes = c.result.reduce((sum, file) => sum + file.blob.size, 0); commit(); };
    tx.oncomplete = () => resolve({ draft, duplicate });
    tx.onerror = tx.onabort = () => reject(error || tx.error || new Error('分享草稿保存失败，请检查本机空间。'));
  });
}
// Saving the task and consuming its draft commit together, including on shutdown.
export const putTaskWithDraft = (task, id, nextDraft) => transaction('readwrite', (store, tx) => {
  store.put(task);
  const drafts = tx.objectStore('drafts');
  if (nextDraft) drafts.put(nextDraft); else drafts.delete(id);
  if (id === 'import' && !nextDraft) tx.objectStore('draft-files').clear();
}, ['tasks', 'drafts', 'draft-files']);

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data.format !== 'shike-backup' || data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > 10000) throw new Error('这不是有效的拾课备份文件。');
  const ids = new Set();
  return data.tasks.map(task => {
    if (!task || typeof task.title !== 'string' || typeof task.id !== 'string' || !task.id || ids.has(task.id)) throw new Error('备份中有无效或重复的任务。');
    ids.add(task.id);
    for (const field of ['createdAt', 'updatedAt']) if (typeof task[field] !== 'string' || !Number.isFinite(Date.parse(task[field]))) throw new Error('备份中的时间格式无效。');
    if (task.completedAt !== null && task.completedAt !== undefined && !Number.isFinite(Date.parse(task.completedAt))) throw new Error('完成时间无效。');
    if (task.dueDate !== undefined && typeof task.dueDate !== 'string') throw new Error('截止日期格式无效。');
    if (task.dueTime !== undefined && typeof task.dueTime !== 'string') throw new Error('截止时间格式无效。');
    if (task.details !== undefined && typeof task.details !== 'string') throw new Error('任务要求格式无效。');
    const error = validateTask(task);
    if (error) throw new Error(error);
    return { ...sanitizeTask(task), updatedAt: task.updatedAt };
  });
}

export const restoreTasks = tasks => transaction('readwrite', store => { for (const task of tasks) store.put(task); });
