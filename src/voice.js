import { appURL } from './offline.js';
import { normalizeNotice } from './domain.js';

let libraryPromise;
async function library() {
  if (globalThis.Vosk?.Model) return globalThis.Vosk;
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = appURL('voice/vosk.js');
    script.onload = () => globalThis.Vosk?.Model ? resolve(globalThis.Vosk) : reject(new Error('中文语音引擎没有正确加载。'));
    script.onerror = () => { libraryPromise = null; script.remove(); reject(new Error('无法加载本地语音引擎，请先准备语音资源。')); };
    document.head.append(script);
  });
  return libraryPromise;
}
export function microphoneError(error) {
  if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)) return '麦克风权限未允许。请在浏览器的网站权限中允许麦克风，再点击开始。';
  if (error?.name === 'NotFoundError') return '没有找到麦克风，请连接麦克风或在平板上使用。';
  if (error?.name === 'NotReadableError') return '麦克风暂时无法使用，可能正被其他程序占用，请稍后重试。';
  return error?.message || '语音输入暂时没有完成，请重试，也可以手动输入文字。';
}

export function createVoiceSession({ onState, onText, onPartial, onError }) {
  let model, recognizer, context, stream, source, capture, mute;
  let state = 'idle', disposed = false, timer, loadTimer, finalTimer, flushTimer;
  let rejectLoad, resolveFinal, resolveFlush, stopPromise;
  const parts = [];
  const change = next => { state = next; if (!disposed) onState(next); };
  const text = () => normalizeNotice(parts.filter(Boolean).join('\n'));
  const assertActive = () => { if (disposed) throw new DOMException('已取消语音输入', 'AbortError'); };
  function releaseMicrophone() {
    stream?.getTracks().forEach(track => track.stop());
    source?.disconnect();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer); clearTimeout(loadTimer); clearTimeout(finalTimer); clearTimeout(flushTimer);
    releaseMicrophone();
    if (capture) { capture.port.onmessage = null; capture.disconnect(); }
    mute?.disconnect();
    context?.close().catch(() => {});
    rejectLoad?.(new DOMException('已取消语音输入', 'AbortError'));
    resolveFinal?.(); resolveFlush?.();
    if (model) { model.terminate(); model.worker?.terminate(); }
  }
  async function stop() {
    if (stopPromise) return stopPromise;
    if (disposed || state !== 'listening') return;
    stopPromise = (async () => {
      change('stopping'); clearTimeout(timer);
      releaseMicrophone();
      await new Promise(resolve => {
        resolveFlush = resolve;
        capture.port.postMessage('flush');
        flushTimer = setTimeout(resolve, 800);
      });
      clearTimeout(flushTimer);
      if (disposed) return;
      await new Promise((resolve, reject) => {
        resolveFinal = resolve;
        finalTimer = setTimeout(() => reject(new Error('最后一句话仍在处理中，请重试这一句；已转出的文字会保留。')), 15000);
        // A dedicated end marker distinguishes final-result acknowledgement from earlier segments.
        model.postMessage({ action: 'retrieveFinalResult', recognizerId: recognizer.id, shikeFinal: true });
      });
      clearTimeout(finalTimer);
      if (!disposed) { change('finished'); onPartial(''); }
      dispose();
    })().catch(error => { if (!disposed) onError(microphoneError(error)); dispose(); });
    return stopPromise;
  }
  async function start() {
    if (disposed || state !== 'idle') return;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('当前网址无法使用麦克风。请使用 HTTPS 地址，或电脑本机的 localhost。');
      if (!globalThis.AudioWorkletNode || !globalThis.AudioContext) throw new Error('当前浏览器不支持本地语音输入，请更换浏览器或使用手动添加。');
      change('loading');
      context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      const Vosk = await library(); assertActive();
      model = new Vosk.Model(appURL('voice/cn-small-0.22.tar.gz'), -1);
      model.worker?.addEventListener?.('error', () => {
        const error = new Error('本地语音引擎启动失败，请检查浏览器支持情况后重试。');
        if (state === 'loading') rejectLoad?.(error);
        else if (!disposed) { onError(error.message); dispose(); }
      });
      await new Promise((resolve, reject) => {
        rejectLoad = reject;
        loadTimer = setTimeout(() => reject(new Error('语音模型加载超时，请关闭窗口后重试。')), 90000);
        model.on('load', event => event.result ? resolve() : reject(new Error('语音模型加载失败，请重新准备语音资源。')));
        model.on('error', event => {
          const error = new Error('本地语音识别发生错误，请关闭窗口后重试。');
          if (state === 'loading') reject(error);
          else if (!disposed) { onError(error.message); dispose(); }
        });
      });
      clearTimeout(loadTimer); rejectLoad = null; assertActive();
      recognizer = new model.KaldiRecognizer(context.sampleRate);
      recognizer.on('result', event => {
        if (disposed) return;
        const phrase = normalizeNotice(event.result?.text || '').trim();
        if (phrase) { parts.push(phrase); onText(text()); }
        if (event.shikeFinal) resolveFinal?.();
      });
      recognizer.on('partialresult', event => { if (!disposed && state === 'listening') onPartial(normalizeNotice(event.result?.partial || '')); });
      recognizer.on('error', () => { if (!disposed) { onError('语音识别中断，已转出的文字仍然保留。'); dispose(); } });
      stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 } });
      if (disposed) { releaseMicrophone(); return; }
      await context.audioWorklet.addModule(appURL('audio-capture.js')); assertActive();
      source = context.createMediaStreamSource(stream);
      capture = new AudioWorkletNode(context, 'local-voice-capture');
      mute = context.createGain(); mute.gain.value = 0;
      capture.port.onmessage = event => {
        if (disposed) return;
        if (event.data.samples) recognizer.acceptWaveformFloat(event.data.samples, context.sampleRate);
        if (event.data.flushed) resolveFlush?.();
      };
      source.connect(capture); capture.connect(mute); mute.connect(context.destination);
      change('listening');
      timer = setTimeout(() => stop(), 120000);
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (state === 'listening') stop(); }));
    } catch (error) { if (!disposed && error.name !== 'AbortError') onError(microphoneError(error)); dispose(); }
  }
  return { start, stop, dispose, get state() { return state; } };
}
