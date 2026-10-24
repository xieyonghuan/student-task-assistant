import { sanitizeTask, validateTask } from './domain.js';

let pendingDB;
function database() {
  if (!pendingDB) pendingDB = new Promise((resolve, reject) => {
    const request = indexedDB.open('shike-study-tasks', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tasks', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { pendingDB = null; reject(request.error); };
    request.onblocked = () => reject(new Error('请关闭其他拾课页面后重试。'));
  });
  return pendingDB;
}

async function transaction(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tasks', mode);
    let value;
    try {
      const req = action(tx.objectStore('tasks'));
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
