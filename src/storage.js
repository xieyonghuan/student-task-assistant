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
