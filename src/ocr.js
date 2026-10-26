import { createWorker, PSM } from 'tesseract.js';
import { appURL } from './offline.js';
import { validDate, normalizeNotice } from './domain.js';
import { isNativeApp, nativeCall } from './native.js';

let activeJob;
let idleSession;
let idleTimer;
const cancelledError = () => new Error('已取消识别。');
function disposeSession(session) {
  if (!session) return;
  session.disposed = true;
  session.worker?.terminate().catch(() => {});
}
function releaseIdleWorker() {
  clearTimeout(idleTimer);
  disposeSession(idleSession);
  idleSession = null;
}
// Keep one recently used engine, and release its WASM memory when idle or hidden.
addEventListener('pagehide', () => { cancelOCR(); releaseIdleWorker(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseIdleWorker(); });
export function cancelOCR() {
  const job = activeJob;
  if (!job) return;
  job.cancelled = true;
  job.rejectCancel?.(cancelledError());
  disposeSession(job.session);
  activeJob = null;
}

async function workerFor(job) {
  const session = idleSession || { worker: null, disposed: false };
  idleSession = null;
  clearTimeout(idleTimer);
  session.job = job;
  job.session = session;
  if (!session.worker) {
    const worker = await createWorker(['chi_sim', 'eng'], 1, {
      workerPath: appURL('ocr/worker.min.js'), corePath: appURL('ocr/core'), langPath: appURL('ocr/lang'),
      workerBlobURL: false, cacheMethod: 'none',
      errorHandler(error) {
        session.disposed = true;
        const current = session.job;
        if (!current || current.cancelled) return;
        current.cancelled = true;
        current.rejectCancel?.(new Error(String(error?.message || error || '本地识别没有完成，请重试。')));
      },
      logger(message) {
        const current = session.job;
        if (!current || current.cancelled || current.refining) return;
        if (message.status === 'recognizing text') current.onProgress('正在识别截图中的文字', 0.35 + message.progress * 0.55);
        else current.onProgress('正在加载本地中文识别资源', Math.min(0.32, (message.progress || 0) * 0.3));
      },
    });
    session.worker = worker;
  }
  if (job.cancelled || session.disposed) { disposeSession(session); throw cancelledError(); }
  return session.worker;
}

function compactBlankRows(canvas, ink) {
  const bands = [];
  const padding = 12, gap = 48;
  const minimumInk = Math.max(2, Math.ceil(canvas.width / 1000));
  for (let y = 0; y < ink.length; y++) {
    if (ink[y] < minimumInk) continue;
    const top = Math.max(0, y - padding), bottom = Math.min(canvas.height, y + padding + 1);
    const last = bands.at(-1);
    if (last && top <= last.bottom + gap) last.bottom = bottom;
    else bands.push({ top, bottom });
  }
  const height = bands.reduce((sum, band) => sum + band.bottom - band.top, gap * (bands.length - 1) + padding * 2);
  if (!bands.length || height >= canvas.height * 0.8) return canvas;
  const compact = document.createElement('canvas');
  compact.width = canvas.width; compact.height = height;
  const ctx = compact.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, compact.width, compact.height);
  let next = padding;
  for (const band of bands) {
    const rows = band.bottom - band.top;
    ctx.drawImage(canvas, 0, band.top, canvas.width, rows, 0, next, canvas.width, rows);
    next += rows + gap;
  }
  canvas.width = canvas.height = 1;
  return compact;
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
  const ink = new Uint32Array(canvas.height);
  // Lift faint watermark/background pixels while preserving colored date text.
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (!invert && pixels.data[i] > 205 && pixels.data[i + 1] > 205 && pixels.data[i + 2] > 205) {
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      continue;
    }
    let grey = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
    if (invert) grey = 255 - grey;
    const value = grey > 205 ? 255 : Math.max(0, Math.round((grey - 90) * 1.6));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    if (value < 180) ink[Math.floor(i / 4 / canvas.width)]++;
  }
  ctx.putImageData(pixels, 0, 0);
  // Remove only large empty horizontal gaps; keep text at its original resolution.
  return compactBlankRows(canvas, ink);
}

async function recognizeNative(file, job) {
  job.onProgress('正在使用本机中文识别', 0.15);
  const bitmap = await createImageBitmap(file);
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80000000) {
    bitmap.close(); throw new Error('图片尺寸过大，请裁剪为课程通知部分后再试。');
  }
  const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height), 1800 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  job.canvas = canvas;
  const content = canvas.toDataURL('image/jpeg', 0.93).split(',')[1];
  if (job.cancelled) throw cancelledError();
  const result = await nativeCall('recognizeImage', { content });
  if (job.cancelled) throw cancelledError();
  if (!result.text?.trim()) throw new Error('本机识别未找到文字。');
  let text = result.text, warning;
  if (result.regions?.length) {
    job.refining = true;
    job.onProgress('正在核对任务名称与截止日期', 0.85);
    try {
      const worker = await workerFor(job);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '' });
      const sx = canvas.width / result.width, sy = canvas.height / result.height;
      for (const region of result.regions.slice(0, 6)) {
        if (job.cancelled) throw cancelledError();
        const left = Math.max(0, Math.floor(region.left * sx) - 12), top = Math.max(0, Math.floor(region.top * sy) - 12);
        const right = Math.min(canvas.width, Math.ceil(region.right * sx) + 12), bottom = Math.min(canvas.height, Math.ceil(region.bottom * sy) + 12);
        if (right <= left || bottom <= top) continue;
        const crop = document.createElement('canvas'); crop.width = right - left; crop.height = bottom - top;
        crop.getContext('2d').drawImage(canvas, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
        let check;
        try { check = await worker.recognize(crop); } finally { crop.width = crop.height = 1; }
        const replacement = normalizeNotice(check.data.text).trim().replace(/\n+/g, ' ');
        if (check.data.confidence >= 70 && replacement.length >= region.text.length * 0.6 && replacement.length <= region.text.length * 1.6) text = text.replace(region.text, replacement);
      }
    } catch (error) {
      if (job.cancelled) throw error;
      warning = '部分任务名称或日期未完成二次核对，请对照原图检查。';
    }
  }
  return { text: normalizeNotice(text), engine: result.regions?.length ? 'native-chinese+verified' : result.engine, warning };
}

async function refineDateLines(worker, canvas, data, job, onProgress) {
  const lines = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines));
  const targets = lines.filter(l => /截止|截至|开始|结束|到期|提交|deadline/i.test(l.text.replace(/\s/g, '')) && /\d{4}[-/.]\d/.test(l.text)).slice(0, 12);
  if (!targets.length || job.cancelled) return data.text;
  job.refining = true;
  onProgress('正在核对开始与截止时间的数字', 0.92);
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
    // Tesseract serializes and decodes the entire canvas even with a rectangle.
    // Send just the numeric line, keeping the same pixels and padding.
    const crop = document.createElement('canvas');
    crop.width = x1 - x0; crop.height = y1 - y0;
    crop.getContext('2d').drawImage(canvas, x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
    let result;
    try { result = await worker.recognize(crop); }
    finally { crop.width = crop.height = 1; }
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

export async function recognizeImage(file, onProgress = () => {}) {
  cancelOCR();
  const job = { cancelled: false, session: null, canvas: null, rejectCancel: null, onProgress };
  activeJob = job;
  const cancellation = new Promise((_, reject) => { job.rejectCancel = reject; });
  let timer;
  let succeeded = false;
  const work = async () => {
    if (isNativeApp()) {
      try { return await recognizeNative(file, job); }
      catch (error) {
        if (job.cancelled) throw error;
        onProgress('正在切换备用离线识别', 0.1);
      }
    }
    // Overlap engine loading with image decoding and pixel preparation.
    const [canvas, worker] = await Promise.all([
      imageCanvas(file).then(canvas => {
        if (job.cancelled) { canvas.width = canvas.height = 1; throw cancelledError(); }
        job.canvas = canvas; return canvas;
      }),
      workerFor(job),
    ]);
    job.canvas = canvas;
    if (job.cancelled) throw new Error('已取消识别。');
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '0', tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const text = await refineDateLines(worker, canvas, data, job, onProgress);
    return { text: normalizeNotice(text), confidence: data.confidence };
  };
  try {
    const result = await Promise.race([work(), cancellation, new Promise((_, reject) => { timer = setTimeout(() => { job.cancelled = true; reject(new Error('识别用时较长，请裁剪截图后重试，或直接粘贴通知文字。')); }, 180000); })]);
    succeeded = !job.cancelled;
    return result;
  } finally {
    clearTimeout(timer);
    if (job.canvas) { job.canvas.width = 1; job.canvas.height = 1; }
    if (succeeded && job.session && !job.session.disposed && !document.hidden) {
      idleSession = job.session;
      idleSession.job = null;
      idleTimer = setTimeout(releaseIdleWorker, 60000);
    } else {
      job.cancelled = true;
      disposeSession(job.session);
    }
    if (activeJob === job) activeJob = null;
  }
}
