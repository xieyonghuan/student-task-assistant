import { createWorker, PSM } from 'tesseract.js';
import { appURL } from './offline.js';
import { validDate, normalizeNotice } from './domain.js';

let activeJob;
export function cancelOCR() {
  const job = activeJob;
  if (!job) return;
  job.cancelled = true;
  job.rejectCancel?.(new Error('已取消识别。'));
  job.worker?.terminate();
  activeJob = null;
}

async function imageCanvas(file) {
  const bitmap = await createImageBitmap(file);
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80000000) {
    bitmap.close(); throw new Error('图片尺寸过大，请裁剪为课程通知部分后再试。');
  }
  // Preserve screenshot detail. Shrinking a long screen can destroy small date digits.
  const scale = Math.min(bitmap.width < 1200 ? 2 : 1, 4000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sample = 0, count = 0;
  for (let i = 0; i < pixels.data.length; i += 256) { sample += (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3; count++; }
  const invert = sample / count < 110;
  // Lift faint watermark/background pixels while preserving colored date text.
  for (let i = 0; i < pixels.data.length; i += 4) {
    let grey = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
    if (invert) grey = 255 - grey;
    const value = grey > 205 ? 255 : Math.max(0, Math.round((grey - 90) * 1.6));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

async function refineDateLines(worker, canvas, data, job, onProgress) {
  const lines = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines));
  const targets = lines.filter(l => /截止|截至|开始|结束|到期|提交|deadline/i.test(l.text.replace(/\s/g, '')) && /\d{4}[-/.]\d/.test(l.text)).slice(0, 12);
  if (!targets.length || job.cancelled) return data.text;
  job.refining = true;
  onProgress('正在核对开始与截止时间的数字', 0.92);
  await worker.reinitialize('eng', 1);
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789-/:. ' });
  let text = data.text;
  for (const line of targets) {
    if (job.cancelled) throw new Error('已取消识别。');
    const words = line.words.filter(w => /\d/.test(w.text));
    if (!words.length) continue;
    const x0 = Math.max(0, Math.min(...words.map(w => w.bbox.x0)) - 10);
    const y0 = Math.max(0, Math.min(...words.map(w => w.bbox.y0)) - 10);
    const x1 = Math.min(canvas.width, Math.max(...words.map(w => w.bbox.x1)) + 10);
    const y1 = Math.min(canvas.height, Math.max(...words.map(w => w.bbox.y1)) + 10);
    const result = await worker.recognize(canvas, { rectangle: { left: x0, top: y0, width: x1 - x0, height: y1 - y0 } });
    const numeric = result.data.text.match(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)(?:[/\s]+(\d{1,2})[:：](\d{2}))?/);
    if (!numeric) continue;
    const date = `${numeric[1]}-${numeric[2].padStart(2, '0')}-${numeric[3].padStart(2, '0')}`;
    if (!validDate(date)) continue;
    const time = numeric[4] !== undefined && +numeric[4] < 24 && +numeric[5] < 60 ? `/${numeric[4].padStart(2, '0')}:${numeric[5]}` : '';
    // Replace only the actual numeric date/time span, never infer an invalid digit.
    const corrected = line.text.replace(/\d{4}[-/.]\d{1,2}[-/.]\d{1,3}(?:[/\s]+\d{1,3}[:：]\d{2})?/, date + time);
    text = text.replace(line.text.trim(), corrected.trim());
  }
  return text;
}

export async function recognizeImage(file, onProgress) {
  cancelOCR();
  const job = { cancelled: false, worker: null, canvas: null, rejectCancel: null };
  activeJob = job;
  const cancellation = new Promise((_, reject) => { job.rejectCancel = reject; });
  let timer;
  const work = async () => {
    const canvas = await imageCanvas(file);
    job.canvas = canvas;
    if (job.cancelled) throw new Error('已取消识别。');
    const worker = await createWorker(['chi_sim', 'eng'], 1, {
      workerPath: appURL('ocr/worker.min.js'), corePath: appURL('ocr/core'), langPath: appURL('ocr/lang'),
      workerBlobURL: false, cacheMethod: 'none',
      errorHandler(error) {
        job.cancelled = true;
        job.rejectCancel?.(new Error(String(error?.message || error || '本地识别没有完成，请重试。')));
      },
      logger(message) {
        if (job.cancelled || job.refining) return;
        if (message.status === 'recognizing text') onProgress('正在识别截图中的文字', 0.35 + message.progress * 0.6);
        else onProgress('正在加载本地中文识别资源', Math.min(0.32, (message.progress || 0) * 0.3));
      },
    });
    job.worker = worker;
    if (job.cancelled) { await worker.terminate(); throw new Error('已取消识别。'); }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '0' });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const text = await refineDateLines(worker, canvas, data, job, onProgress);
    return { text: normalizeNotice(text), confidence: data.confidence };
  };
  try {
    return await Promise.race([work(), cancellation, new Promise((_, reject) => { timer = setTimeout(() => { job.cancelled = true; reject(new Error('识别用时较长，请裁剪截图后重试，或直接粘贴通知文字。')); }, 180000); })]);
  } finally {
    clearTimeout(timer);
    if (job.canvas) { job.canvas.width = 1; job.canvas.height = 1; }
    if (job.worker) await job.worker.terminate();
    if (activeJob === job) activeJob = null;
  }
}
