import { newId, extractTasks } from './domain.js';
import { validateImages } from './batch.js';
import { loadDraft, appendSharedDraft } from './storage.js';

export function formatSharedTasks(tasks) {
  if (!tasks.length) throw new Error('请至少选择一项课程任务。');
  const text = '拾课课程任务\n\n' + tasks.map((task, index) => `${index + 1}. ${task.title}\n截止时间：${task.dueDate ? task.dueDate + (task.dueTime ? ' ' + task.dueTime : '（当天 00:00）') : '暂无截止日期'}${task.details ? '\n要求：' + task.details : ''}${task.completedAt ? '\n状态：已完成' : ''}`).join('\n\n');
  if (text.length > 100000) throw new Error('分享内容过长，请减少任务数量。');
  return text;
}

export async function receiveSharedItem(item) {
  if (!/^[a-f0-9-]{36}$/.test(item.id) || typeof item.text !== 'string' || item.text.length > 100000 || !Array.isArray(item.images)) throw new Error('收到的分享格式无效。');
  // Acknowledge only after the exact share ID and draft are committed together.
  // Receipt survives draft cleanup, so a crash before native acknowledgement is safe.
  const receipts = await loadDraft('share-receipts');
  if (receipts?.ids.includes(item.id)) return { duplicate: true };
  const files = [];
  for (const image of item.images) {
    const url = new URL(image.url);
    if (url.origin !== location.origin || !url.pathname.startsWith(`/shared/${item.id}/`) || url.search || url.hash || /(?:^|\/)\.\.(?:\/|$)/.test(url.pathname)) throw new Error('分享图片地址无效。');
    const response = await fetch(url);
    if (!response.ok) throw new Error('分享图片暂时无法读取，已保留，可稍后重试。');
    const blob = await response.blob();
    files.push(new File([blob], image.name || '分享截图', { type: image.type || blob.type }));
  }
  if (files.length) { const error = validateImages(files); if (error) throw new Error(error); }
  if (!files.length && !item.text.trim()) throw new Error('分享中没有文字或图片。');
  const referenceTime = new Date(item.receivedAt || Date.now()).toISOString();
  const sources = files.map(file => ({ id: newId(), name: file.name, status: 'pending', text: '', referenceTime }));
  const tasks = item.text.trim() ? extractTasks(item.text, new Date(referenceTime)).map(task => ({ ...task, sourceId: `shared-text-${item.id}`, selected: true })) : [];
  return appendSharedDraft(item.id, { text: item.text, sources, tasks, referenceTime }, files.map((blob, index) => ({ id: sources[index].id, blob })));
}

