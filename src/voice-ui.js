import { prepareVoiceOffline, voiceOfflineStatus } from './offline.js';
import { createVoiceSession } from './voice.js';

export async function openVoiceInput({ openDialog, icon, onTextReady }) {
  let session, ready = false, busy = false, preparing = false, elapsedTimer;
  const downloadController = new AbortController();
  const dialog = openDialog('语音添加任务', '说出任务名称和要求，转成文字后由你检查，确认后才会保存。', `
    <div class="voice-intro"><div class="voice-orb" id="voice-orb">${icon('mic')}</div><h3 id="recording-status" aria-live="polite">先准备，再轻松说出来</h3><p>中文本地识别 · 声音不上传 · 录音不保存</p></div>
    <div class="voice-resource"><div><strong id="voice-resource-title">正在检查语音资源</strong><p id="voice-resource-status" role="status">首次准备需要联网，之后可离线使用。</p></div><button class="button button-light" id="prepare-voice" disabled>${icon('download')} 准备语音资源</button></div>
    <div class="ocr-progress" id="voice-download-progress" role="progressbar" aria-label="语音资源准备进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><i></i></div>
    <div class="voice-controls"><button class="button button-primary" id="voice-start" disabled>${icon('mic')} 开始说话</button><button class="button button-light" id="voice-stop" disabled>${icon('stop')} 停止并转写</button><span id="voice-elapsed">每次最多 2 分钟</span></div>
    <p class="voice-partial" id="voice-partial" aria-live="polite"></p>
    <label class="field">语音转写 <span class="optional">停止后可以修改</span><textarea id="voice-transcript" rows="5" maxlength="30000" placeholder="例如：完成数学第三章习题，明天提交，需要写出计算过程。"></textarea></label>
    <p class="field-note">日期不明确时，接下来会弹出对应任务的日期选择框。识别可能有错字，请先核对。</p>
    <p class="form-error" id="voice-error" role="alert"></p>
    <div class="modal-actions"><button class="button button-light" id="voice-cancel">取消</button><button class="button button-primary" id="voice-use" disabled>整理为任务 ${icon('arrow')}</button></div>`, {
      onClose() { downloadController.abort(); session?.dispose(); clearInterval(elapsedTimer); },
    });
  const $ = selector => dialog.querySelector(selector);
  const transcript = $('#voice-transcript');
  const supported = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && !!globalThis.AudioWorkletNode && !!globalThis.AudioContext;
  function update() {
    $('#voice-start').disabled = !ready || busy || preparing || !supported;
    $('#voice-stop').disabled = session?.state !== 'listening';
    $('#voice-use').disabled = busy || !transcript.value.trim();
    $('#prepare-voice').disabled = busy || preparing || !supported;
    transcript.readOnly = busy;
  }
  function finishedUI() {
    busy = false; clearInterval(elapsedTimer);
    $('#voice-orb').classList.remove('listening');
    update();
  }
  transcript.addEventListener('input', update);
  $('#voice-cancel').onclick = () => dialog.close();
  $('#prepare-voice').onclick = async () => {
    if (preparing) return;
    preparing = true; update(); $('#voice-error').textContent = '';
    $('#voice-download-progress').hidden = false;
    try {
      await prepareVoiceOffline(progress => {
        if (!dialog.open) return;
        const percent = Math.round(progress * 100);
        $('#voice-download-progress i').style.width = `${percent}%`;
        $('#voice-download-progress').setAttribute('aria-valuenow', percent);
        $('#voice-resource-status').textContent = `正在准备中文语音资源… ${percent}%`;
      }, downloadController.signal);
      if (!dialog.open) return;
      ready = true;
      $('#voice-resource-title').textContent = '中文语音资源已就绪';
      $('#voice-resource-status').textContent = '可以离线使用。点击开始后，浏览器会询问麦克风权限。';
      $('#prepare-voice').textContent = '检查语音资源';
    } catch (error) { if (dialog.open && error.name !== 'AbortError') $('#voice-error').textContent = error.message; }
    finally { preparing = false; if (dialog.open) update(); }
  };
  $('#voice-start').onclick = () => {
    if (busy || !ready || !supported) return;
    session?.dispose();
    $('#voice-error').textContent = ''; $('#voice-partial').textContent = '';
    const original = transcript.value.trim();
    session = createVoiceSession({
      onText(text) { if (dialog.open) { transcript.value = `${original ? original + '\n' : ''}${text}`.slice(0, 30000); update(); } },
      onPartial(text) { if (dialog.open) $('#voice-partial').textContent = text ? `正在听：${text}` : ''; },
      onState(state) {
        if (!dialog.open) return;
        busy = ['loading', 'listening', 'stopping'].includes(state);
        $('#recording-status').textContent = ({ loading: '正在加载本地语音模型…', listening: '正在听，请说出你的学习任务', stopping: '正在整理最后一句话…', finished: '说好了，核对一下文字吧' })[state] || '可以开始下一段语音';
        if (state === 'listening') {
          const started = Date.now();
          $('#voice-orb').classList.add('listening');
          elapsedTimer = setInterval(() => { if (dialog.open) $('#voice-elapsed').textContent = `已说 ${Math.floor((Date.now() - started) / 1000)} 秒 / 最多 120 秒`; }, 1000);
        }
        if (state === 'stopping') { clearInterval(elapsedTimer); $('#voice-orb').classList.remove('listening'); }
        if (state === 'finished') {
          if (!transcript.value.trim()) $('#recording-status').textContent = '没有听到清晰文字，请再试一次';
          finishedUI();
        }
        update();
      },
      onError(message) { if (dialog.open) { $('#voice-error').textContent = message; $('#recording-status').textContent = '这次语音输入没有完成'; finishedUI(); } },
    });
    session.start();
  };
  $('#voice-stop').onclick = () => session?.stop();
  $('#voice-use').onclick = () => {
    if (busy || !transcript.value.trim()) return;
    const text = transcript.value.trim(); dialog.close(); onTextReady(text);
  };
  if (!supported) {
    $('#voice-resource-title').textContent = '当前环境无法使用麦克风输入';
    $('#voice-resource-status').textContent = '请使用支持麦克风与本地音频处理的浏览器，在 HTTPS 地址或电脑 localhost 打开。也可以在下方输入文字。';
    update(); return;
  }
  try {
    const status = await voiceOfflineStatus();
    if (!dialog.open) return;
    ready = status.ready;
    $('#voice-resource-title').textContent = ready ? '中文语音资源已就绪' : '首次使用，准备中文语音资源';
    $('#voice-resource-status').textContent = ready ? '可以离线使用。点击开始后，浏览器会询问麦克风权限。' : `约 ${Math.ceil(status.bytes / 1024 / 1024)} MB，准备好后声音只在本机识别。`;
    if (ready) $('#prepare-voice').textContent = '检查语音资源';
  } catch (error) { if (dialog.open) $('#voice-error').textContent = error.message; }
  if (dialog.open) update();
}
