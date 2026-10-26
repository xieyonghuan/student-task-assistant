import { findDuplicates } from './domain.js';

export const IMAGE_LIMIT = 20;
export const BATCH_BYTES = 100 * 1024 * 1024;
export function validateImages(files) {
  if (!files.length) return '请选择课程通知截图。';
  if (files.length > IMAGE_LIMIT) return `一次最多选择 ${IMAGE_LIMIT} 张截图。`;
  if (files.some(file => !/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || file.size > 20 * 1024 * 1024)) return '每张图片需为不超过 20 MB 的 PNG、JPG、WebP 或 BMP。';
  if (files.reduce((sum, file) => sum + file.size, 0) > BATCH_BYTES) return '这一批截图超过 100 MB，请分批导入。';
  return '';
}

export function batchDuplicates(task, tasks) {
  return findDuplicates(task, tasks, task.id).filter(other => other.sourceId !== task.sourceId);
}

export function hasImportDraft(draft) {
  return !!(draft?.text?.trim() || draft?.tasks?.length || draft?.sources?.length);
}

export function importFinished(draft) {
  return !draft.tasks.length && draft.sources.every(source => ['done', 'skipped'].includes(source.status));
}
