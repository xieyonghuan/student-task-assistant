import { createWorker, PSM } from 'tesseract.js';
import { appURL } from './offline.js';
import { validDate, normalizeNotice } from './domain.js';
import { isNativeApp, nativeCall } from './native.js';
import { courseTableAtlas, unpackCourseTable } from './course-table-image.js';

let activeJob;
let idleSession;
let idleTimer;
const cancelledError = () => new Error('已取消识别。');
async function pixelKey(canvas,kind) {
  const bytes=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return `${kind}:${canvas.width}:${canvas.height}:${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}`;
}
function cachePut(cache,key,value) {
  cache.delete(key);cache.set(key,value);
  if(cache.size>256)cache.delete(cache.keys().next().value);
}
async function recognizeNumber(worker,canvas,job) {
  const cache=job.session.numberCache ||= new Map(),key=await pixelKey(canvas,'number');
  if(cache.has(key)){job.cacheHits++;return cache.get(key);}
  if(job.cancelled)throw cancelledError();
  const result=await worker.recognize(canvas);job.recognitions++;
  if(job.cancelled)throw cancelledError();
  cachePut(cache,key,result);return result;
}
function disposeSession(session) {
  if (!session) return;
  session.disposed = true;
  session.worker?.terminate().catch(() => {});
  session.numericWorker?.terminate().catch(() => {});
  session.cellCache?.clear();session.numberCache?.clear();
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
  const language=job.layout?'chi_sim':'chi_sim+eng';
  if(idleSession&&idleSession.language!==language)releaseIdleWorker();
  const session = idleSession || { worker: null, disposed: false };
  session.language=language;
  idleSession = null;
  clearTimeout(idleTimer);
  session.job = job;
  job.session = session;
  if (!session.worker) {
    const worker = await createWorker(job.layout ? 'chi_sim' : ['chi_sim', 'eng'], 1, {
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

async function imageCanvas(file, keepLayout = false) {
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
  if (keepLayout) return canvas;
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
  return keepLayout ? canvas : compactBlankRows(canvas, ink);
}

async function recognizeNative(file, job, accuracy) {
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
  const result = await nativeCall('recognizeImage', { content, accuracy });
  if (job.cancelled) throw cancelledError();
  if (!result.text?.trim()) throw new Error('本机识别未找到文字。');
  let text = result.text, warning;
  if (accuracy === 'accurate' && result.regions?.length) {
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
  return { text: normalizeNotice(text), engine: accuracy === 'accurate' && result.regions?.length ? 'native-chinese+verified' : result.engine, warning };
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

export async function recognizeImage(file, onProgress = () => {}, { accuracy = 'stable', layout = false } = {}) {
  cancelOCR();
  const started=performance.now();
  const job = { cancelled: false, session: null, canvas: null, rejectCancel: null, onProgress, layout,cacheHits:0,recognitions:0 };
  activeJob = job;
  const cancellation = new Promise((_, reject) => { job.rejectCancel = reject; });
  let timer;
  let succeeded = false;
  const work = async () => {
    if (!layout && isNativeApp() && (accuracy === 'fast' || accuracy === 'accurate')) {
      try { return await recognizeNative(file, job, accuracy); }
      catch (error) {
        if (job.cancelled) throw error;
        onProgress('正在切换备用离线识别', 0.1);
      }
    }
    // Overlap engine loading with image decoding and pixel preparation.
    const [canvas, worker] = await Promise.all([
      imageCanvas(file, layout).then(canvas => {
        if (job.cancelled) { canvas.width = canvas.height = 1; throw cancelledError(); }
        job.canvas = canvas; return canvas;
      }),
      workerFor(job),
    ]);
    job.canvas = canvas;
    if (job.cancelled) throw new Error('已取消识别。');
    const atlas = layout ? courseTableAtlas(canvas) : null;
    if (atlas) {
      job.onProgress('正在按课程单元格读取名称与上课安排', .45);
      try {
        const texts=new Map();
        if(!job.session.numericWorker){
          const numeric=await createWorker('eng',1,{workerPath:appURL('ocr/worker.min.js'),corePath:appURL('ocr/core'),langPath:appURL('ocr/lang'),workerBlobURL:false,cacheMethod:'none'});
          if(job.cancelled||job.session.disposed){await numeric.terminate();throw cancelledError();}
          job.session.numericWorker=numeric;
        }
        const numeric=job.session.numericWorker;
        const cellCache=job.session.cellCache ||= new Map();
        await numeric.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE,tessedit_char_whitelist:'0123456789-,/'});
        for(let i=0;i<atlas.packed.length;i++){
          if(job.cancelled)throw cancelledError();
          const entry=atlas.packed[i],crop=document.createElement('canvas');crop.width=entry.width+32;crop.height=entry.height+32;
          const ctx=crop.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,crop.width,crop.height);ctx.drawImage(atlas.canvas,entry.x,entry.y,entry.width,entry.height,16,16,entry.width,entry.height);
          try{
            const key=await pixelKey(crop,entry.kind);
            if(cellCache.has(key)){texts.set(entry.cell,cellCache.get(key));job.cacheHits++;continue;}
            if(job.cancelled)throw cancelledError();
            if(entry.kind!=='code')await worker.setParameters({tessedit_pageseg_mode:['name','time'].includes(entry.kind)?PSM.SINGLE_BLOCK:PSM.SINGLE_LINE,tessedit_char_whitelist:entry.kind==='time'?'0123456789-,/|第周星期一二三四五六日天单双节()':''});
            const {data}=await (entry.kind==='code'?numeric:worker).recognize(crop,{}, {text:true,blocks:entry.kind==='time'});
            job.recognitions++;
            let value=data.text.replace(/\s/g,'');
            if(entry.kind==='time'){
              const lines=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines));
              const corrected=[];
              for(const [li,line] of lines.entries()){const parts=[];const periodLine=/(?:星期|周)[一二三四五六日天]/.test(lines.slice(0,li+1).map(l=>l.text.replace(/\s/g,'')).join(''));
                for(let wi=0;wi<line.words.length;wi++){const word=line.words[wi];let text=word.text;
                  if(/^[\d,-]+$/.test(text)&&/\d/.test(text)){
                    const group=[word];while(wi+1<line.words.length&&/^[\d,-]+$/.test(line.words[wi+1].text))group.push(line.words[++wi]);text=group.map(w=>w.text).join('');
                    const left=Math.max(0,Math.min(...group.map(w=>w.bbox.x0))),top=Math.max(0,Math.min(...group.map(w=>w.bbox.y0))),right=Math.min(crop.width,Math.max(...group.map(w=>w.bbox.x1))),bottom=Math.min(crop.height,Math.max(...group.map(w=>w.bbox.y1)));
                    const check=document.createElement('canvas');check.width=right-left+16;check.height=bottom-top+16;const ctx=check.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,check.width,check.height);ctx.drawImage(crop,left,top,right-left,bottom-top,8,8,right-left,bottom-top);
                    try{const result=await recognizeNumber(numeric,check,job);const number=result.data.text.replace(/\s/g,'').replace(/^[/|]+|[/|]+$/g,'');const values=(number.match(/\d+/g)||[]).map(Number);if(result.data.confidence>=65&&/^\d{1,2}(?:[-,]\d{1,2})*[-,]?$/.test(number)&&values.every(n=>n>=1&&n<=(periodLine?20:60))&&(!periodLine||values.length<2||values[1]>=values[0])&&(number.match(/-/g)||[]).length===(text.match(/-/g)||[]).length&&(number.match(/,/g)||[]).length===(text.match(/,/g)||[]).length)text=number;}finally{check.width=check.height=1;}
                  }
                  parts.push(text);
                }
                corrected.push(parts.join(''));
              }
              if(corrected.length)value=corrected.join('');
              const tail=value.match(/([/|])(\d+)(?:-(\d+))?节?$/);
              const validPeriod=m=>m&&+m[2]>=1&&+(m[3]||m[2])>=+m[2]&&+(m[3]||m[2])<=20;
              if(tail&&!validPeriod(tail)){
                for(const mode of [PSM.SPARSE_TEXT,PSM.SINGLE_COLUMN]){
                  await worker.setParameters({tessedit_pageseg_mode:mode,tessedit_char_whitelist:'0123456789-,/|第周星期一二三四五六日天单双节()'});
                  const check=await worker.recognize(crop);const replacement=check.data.text.replace(/\s/g,'').match(/([/|])(\d+)(?:-(\d+))?节?$/);
                  if(validPeriod(replacement)){value=value.slice(0,tail.index)+replacement[0];break;}
                }
              }
            }
            texts.set(entry.cell,value);
            if(job.cancelled)throw cancelledError();
            cachePut(cellCache,key,value);
          }finally{crop.width=crop.height=1;}
          job.onProgress('正在读取课程名称与上课安排',.35+.6*(i+1)/atlas.packed.length);
        }
        return { text: [...texts.values()].join('\n'), table: unpackCourseTable(atlas,[],texts), lines: [], engine: 'local-table-cells', width: canvas.width, height: canvas.height };
      } finally { atlas.canvas.width=atlas.canvas.height=1; }
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '0', tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const text = layout ? data.text : await refineDateLines(worker, canvas, data, job, onProgress);
    const lines = layout ? (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines)).flatMap(l => {
      // Sparse OCR can put several timetable columns on one logical text line.
      // Split only large geometric gaps, retaining original screenshot coordinates.
      const groups = []; let group = [];
      for (const word of l.words || []) {
        const previous = group.at(-1);
        if (previous && word.bbox.x0 - previous.bbox.x1 > Math.max(16, (l.bbox.y1 - l.bbox.y0) * .8)) { groups.push(group); group = []; }
        group.push(word);
      }
      if (group.length) groups.push(group);
      return groups.length > 1 ? groups.map(words => ({ text: words.map(w=>w.text).join(' '), confidence: l.confidence,
        bbox: { x0: Math.min(...words.map(w=>w.bbox.x0)), y0: Math.min(...words.map(w=>w.bbox.y0)), x1: Math.max(...words.map(w=>w.bbox.x1)), y1: Math.max(...words.map(w=>w.bbox.y1)) } }))
        : [{ text: l.text.trim(), bbox: l.bbox, confidence: l.confidence }];
    }) : undefined;
    return { text: normalizeNotice(text), confidence: data.confidence, engine: 'local-stable', ...(layout ? { lines, width: canvas.width, height: canvas.height } : {}) };
  };
  try {
    const result = await Promise.race([work(), cancellation, new Promise((_, reject) => { timer = setTimeout(() => { job.cancelled = true; reject(new Error('识别用时较长，请裁剪截图后重试，或直接粘贴通知文字。')); }, 180000); })]);
    succeeded = !job.cancelled;
    return {...result,elapsedMs:Math.round(performance.now()-started),cacheHits:job.cacheHits,recognitions:job.recognitions};
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
