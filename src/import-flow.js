import { newId, extractTasks, extractDeadline, localDate, validDate, validateTask } from './domain.js';
import { putDraft, deleteDraft, replaceImportDraft, loadDraftFile, putTaskWithDraft } from './storage.js';
import { validateImages, batchDuplicates, hasImportDraft, importFinished } from './batch.js';

export function createImportFlow({ restored, example = '', initialText = '', mode = 'image', returnView, ui }) {
  const { $, $$, esc, icon, taskFields, readTaskFields } = ui;
  const model = restored ? structuredClone(restored) : { id: 'import', text: example || initialText, tasks: [], sources: [], saved: 0, skipped: 0, stage: 'capture', overview: false, mode };
  model.referenceTime ||= model.updatedAt || new Date().toISOString();
  for (const source of model.sources) if (source.status === 'running') source.status = 'pending';
  let alive = true, busy = false, saving = false, completed = false, ocr, writeTail = Promise.resolve(), previewURL, lastPreviewId;
  const imageURLs = new Set();
  function releaseImages() { for (const url of imageURLs) URL.revokeObjectURL(url); imageURLs.clear(); previewURL = undefined; lastPreviewId = null; }
  const element = document.createElement('section');
  element.className = 'import-page glass'; element.setAttribute('aria-label', '通知导入与任务确认');
  element.innerHTML = `<div class="import-page-nav"><button class="text-button" id="back-to-source">← 返回修改原文</button><button class="button button-light" id="continue-review">继续确认任务 →</button></div><p id="draft-state" class="source-note" role="status">草稿自动保存在本机；保存完成后自动清理。</p><div class="import-steps"><span><b>1</b> 导入通知</span><i></i><span><b>2</b> 逐张识别</span><i></i><span><b>3</b> 汇总确认</span></div><div class="import-layout"><section class="source-panel"><h3>课程通知 <span>仅在本地处理</span></h3><input id="screenshot-file" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" multiple hidden><div id="image-drop" class="image-drop" tabindex="0" role="button" aria-label="选择课程通知截图"><div id="image-preview"><span class="upload-symbol">${icon('upload')}</span><strong>选择一张或多张课程通知截图</strong><p>点击选择，或将图片拖到这里</p><small>最多 20 张 · 每张不超过 20 MB · 合计不超过 100 MB</small></div></div><div id="source-list"></div><label class="field">通知文字 <span class="optional">也可以直接粘贴</span><textarea id="notification-text" rows="7" maxlength="100000" placeholder="识别后的文字会显示在这里，也可以粘贴通知文字。"></textarea></label><button id="extract-tasks" class="button button-light full-width">${icon('spark')} 从文字提取任务</button><p class="source-note">截图暂存于本机草稿，整批保存完成或放弃草稿后清理，不随任务保存。</p></section><section id="review-panel" class="review-panel"></section></div>`;
  const raw = $('#notification-text', element), panel = $('#review-panel', element), sourcePanel = $('.source-panel', element);
  raw.value = model.text;
  model.accuracy ||= 'fast';
  const options = document.createElement('div'); options.className = 'import-options';
  options.innerHTML = `<label class="field">识别方式<select id="ocr-accuracy"><option value="fast">快速识别（默认）</option><option value="accurate">精细复核（较慢）</option></select></label><label class="field">通知发出日期<input id="notice-date" type="date" min="1900-01-01" max="2200-12-31" value="${localDate(new Date(model.referenceTime))}"></label><button class="text-button" id="recalculate-date">重算相对截止日期</button><p class="source-note">“下周一”等时间按通知发出日期计算；旧通知请改日期后重算。精细模式额外核对文字，耗时更长。</p>`;
  $('#draft-state', element).after(options);
  $('#ocr-accuracy', options).value = model.accuracy;
  $('#ocr-accuracy', options).onchange = event => { model.accuracy = event.target.value; persist(); };
  function updateReference() {
    const date = $('#notice-date', options).value;
    if (!validDate(date)) throw new Error('请选择有效的通知日期。');
    const prior = new Date(model.referenceTime), [year, month, day] = date.split('-').map(Number);
    model.referenceTime = new Date(year, month - 1, day, prior.getHours(), prior.getMinutes(), prior.getSeconds()).toISOString();
    for (const source of model.sources) source.referenceTime = model.referenceTime;
  }
  $('#notice-date', options).onchange = () => ui.safely(async () => { updateReference(); await persist(true); });
  $('#recalculate-date', options).onclick = () => ui.safely(async () => {
    remember(); updateReference();
    for (const task of model.tasks) if (/(?:下|本|这)?(?:周|週)|星期|礼拜|[今明后]天|[今明后]日|[今明]晚|\bnext\s*(?:mon|tues|wednes|thurs|fri|satur|sun)day/i.test(task.details)) Object.assign(task, extractDeadline(task.details, new Date(model.referenceTime)));
    if (model.tasks.length) showDraft(); await persist(true); ui.toast('已按通知发出日期重算，请核对截止日期。');
  });
  function snapshot() { return { ...structuredClone(model), updatedAt: new Date().toISOString() }; }
  function remember() {
    const form = $('#review-form', panel);
    const index = form ? model.tasks.findIndex(task => task.id === form.dataset.id) : -1;
    if (index >= 0) model.tasks[index] = readTaskFields(form, model.tasks[index], false);
    for (const card of $$('.batch-task', panel)) {
      const task = model.tasks.find(task => task.id === card.dataset.id);
      if (!task) continue;
      Object.assign(task, readTaskFields($('form', card), task, false), { selected: $('[name="selected"]', card).checked });
      task.dateConfirmed = !!task.dueDate || $('[name="undated"]', card).checked;
    }
    model.text = raw.value;
  }
  function serial(action) {
    const next = writeTail.catch(() => {}).then(action);
    writeTail = next;
    return next;
  }
  function status(message, error = false) {
    const node = $('#draft-state', element); node.textContent = message;
    node.classList.toggle('form-error', error);
  }
  function persist(required = false) {
    remember();
    ui.onDraft(!completed && hasImportDraft(model) ? snapshot() : null);
    status('正在保存本机草稿…');
    const promise = serial(async () => {
      if (!completed && hasImportDraft(model)) await putDraft(snapshot()); else await deleteDraft('import');
      status('草稿已自动保存在本机，刷新后可继续。');
    });
    if (required) return promise;
    promise.catch(error => status(`草稿保存失败：${error.message} 请勿刷新，可重试保存。`, true));
    return promise.catch(() => {});
  }
  function goTo(stage, replace = false) { model.stage = stage; ui.goTo(stage, replace); }
  function filesList() {
    $('#source-list', element).innerHTML = model.sources.length ? `<ul class="source-files">${model.sources.map((source, index) => `<li>${index + 1}. ${esc(source.name)} <span>${({ pending: '待识别', running: '识别中', done: '已识别', failed: '失败，可重试', skipped: '已跳过' })[source.status]}</span></li>`).join('')}</ul>` : '';
  }
  async function preview(sourceId) {
    if (lastPreviewId === sourceId) return;
    lastPreviewId = sourceId;
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = undefined;
    const file = sourceId ? await loadDraftFile(sourceId) : null;
    if (!alive || lastPreviewId !== sourceId || !file) return;
    previewURL = URL.createObjectURL(file.blob);
    imageURLs.add(previewURL);
    const image = $('.source-reference img', panel);
    if (image) { image.src = previewURL; image.hidden = false; }
  }
  function failures() {
    const failed = model.sources.filter(source => source.status === 'failed');
    return failed.length ? `<div class="notice warning"><div><strong>${failed.length} 张截图尚未识别成功</strong>${failed.map(source => `<p>${esc(source.name)}：${esc(source.error)}</p>`).join('')}<button class="text-button" id="retry-images">重试失败截图</button><button class="text-button" id="skip-images">跳过失败截图</button></div></div>` : '';
  }
  function bindFailures() {
    const retry = $('#retry-images', panel), skip = $('#skip-images', panel);
    if (retry) retry.onclick = () => { for (const source of model.sources) if (source.status === 'failed') source.status = 'pending'; runQueue(); };
    if (skip) skip.onclick = () => ui.safely(async () => {
      for (const source of model.sources) if (source.status === 'failed') source.status = 'skipped';
      if (importFinished(model)) { await serial(() => deleteDraft('import')); completed = true; ui.onDraft(null); } else await persist(true);
      showDraft();
    });
  }
  function done() {
    releaseImages();
    panel.innerHTML = `${failures()}<div class="review-placeholder review-done"><span class="success-symbol">${icon('check')}</span><h3>这批通知，整理好了</h3><p>已保存 ${model.saved} 项，已跳过 ${model.skipped} 项。<br>已保存的内容已从草稿中清理。</p><button class="button button-primary" id="finish-import">回到我的任务 ${icon('arrow')}</button></div>`;
    $('#finish-import', panel).onclick = ui.finish;
    bindFailures(); goTo('review');
  }
  async function consume(task, draftId, skipped = false) {
    await serial(async () => {
      const next = snapshot();
      next.tasks = next.tasks.filter(candidate => candidate.id !== draftId);
      if (skipped) next.skipped++; else next.saved++;
      const finished = importFinished(next);
      if (task) await putTaskWithDraft(task, 'import', finished ? null : next);
      else if (finished) await deleteDraft('import'); else await putDraft(next);
      Object.assign(model, next);
      completed = finished;
      ui.onDraft(finished ? null : snapshot());
    });
  }
  function sourceName(task) { return model.sources.find(source => source.id === task.sourceId)?.name || '通知文字'; }
  function overview() {
    releaseImages();
    const items = model.tasks.map(task => {
      const matches = batchDuplicates(task, model.tasks);
      const source = model.sources.find(source => source.id === task.sourceId);
      const hint = [task.dateHint, source?.warning].filter(Boolean).join(' ');
      return `<article class="batch-task" data-id="${esc(task.id)}"><label class="batch-select"><input type="checkbox" name="selected" ${task.selected === false ? '' : 'checked'}> 保存这项任务 <small>来自 ${esc(sourceName(task))}</small></label>${matches.length ? `<p class="notice warning">可能与 ${esc(matches.map(sourceName).join('、'))} 中的作业重复。请取消不需要的项；日期不同的任务也请核对。</p>` : ''}${hint ? `<p class="notice warning">${esc(hint)}</p>` : ''}${source ? `<details class="source-reference" data-source="${esc(source.id)}"><summary>查看原文与截图</summary><pre>${esc(source.text)}</pre><img alt="导入的课程通知截图" hidden></details>` : ''}<form>${taskFields(task, 'batch-' + task.id + '-')}<label class="field undated-choice"><span><input type="checkbox" name="undated" ${task.dateConfirmed && !task.dueDate ? 'checked' : ''}> 暂无截止日期</span></label></form></article>`;
    }).join('');
    panel.innerHTML = `<div class="review-heading"><span class="feature-label">${icon('check')} 汇总确认</span><strong>待确认 ${model.tasks.length} 项任务 · ${model.sources.length} 张截图</strong></div><p class="review-tip">核对名称、日期和要求；疑似重复的作业可取消勾选，全部核对后统一保存。</p>${failures()}<div class="batch-tasks">${items}</div><p class="form-error" id="batch-error" role="alert"></p><button class="button button-primary" id="save-batch">确认并保存所选任务</button>`;
    panel.oninput = event => {
      const card = event.target.closest('.batch-task');
      if (card && event.target.name === 'undated' && event.target.checked) {
        const form = $('form', card); form.elements.dueDate.value = ''; form.elements.dueTime.value = '';
      } else if (card && event.target.name === 'dueDate' && event.target.value) {
        $('[name="undated"]', card).checked = false;
      }
      persist();
    };
    for (const details of $$('details[data-source]', panel)) details.ontoggle = () => {
      if (!details.open || $('img', details).getAttribute('src')) return;
      loadDraftFile(details.dataset.source).then(file => {
        if (!alive || !details.isConnected || !details.open || !file) return;
        const url = URL.createObjectURL(file.blob); imageURLs.add(url);
        const image = $('img', details); image.src = url; image.hidden = false;
      }).catch(error => ui.toast(error.message, true));
    };
    $('#save-batch', panel).onclick = saveBatch;
    bindFailures(); goTo('review');
  }
  async function saveBatch() {
    if (saving) return;
    remember();
    const selected = model.tasks.filter(task => task.selected !== false);
    const invalid = selected.find(task => validateTask(task) || (!task.dueDate && !task.dateConfirmed));
    if (invalid) { $('#batch-error', panel).textContent = `${invalid.title || '这项任务'}：${validateTask(invalid) || '请填写截止日期，或勾选“暂无截止日期”。'}`; return; }
    if (!selected.length) { $('#batch-error', panel).textContent = '请至少选择一项任务。'; return; }
    saving = true; $('.batch-tasks', panel).inert = true; $('#save-batch', panel).disabled = true;
    try {
      await persist(true);
      for (const task of [...model.tasks]) {
        if (!alive) break;
        if (task.selected === false) { await consume(null, task.id, true); continue; }
        const result = await new Promise(resolve => ui.saveWithChecks({ ...task, dateConfirmed: true }, {
          persistTask: candidate => consume(candidate, task.id),
          afterSave: () => resolve(true),
          onSkip: () => consume(null, task.id, true).then(() => resolve(true), () => resolve(false)),
          onCancel: () => resolve(false), onError: () => resolve(false),
        }));
        if (!result) break;
      }
    } catch (error) { ui.toast(error.message, true); }
    finally { saving = false; if (alive) showDraft(); }
  }
  function showDraft() {
    if (!alive) return;
    filesList();
    if (!model.tasks.length) { done(); return; }
    const taskCard = [model.text, ...model.sources.map(source => source.text)].some(text => /拾\s*课\s*[·・.。]?\s*课程任务/.test(text || ''));
    if (model.overview || (taskCard && model.tasks.length > 1)) { overview(); return; }
    releaseImages();
    const task = model.tasks[0];
    const total = model.saved + model.skipped + model.tasks.length;
    const originalText = model.sources.find(source => source.id === task.sourceId)?.text || model.text;
    panel.innerHTML = `<div class="review-heading"><span class="feature-label">${icon('check')} 逐项确认</span><strong>第 ${model.saved + model.skipped + 1} / ${total} 项任务</strong></div><p class="review-tip">填写内容自动暂存，确认保存后清理对应草稿。</p>${task.dateHint ? `<div class="notice compact">${esc(task.dateHint)}</div>` : ''}<details class="source-reference"><summary>查看通知原文${task.sourceId ? '与截图' : ''}</summary><pre>${esc(originalText)}</pre>${task.sourceId ? '<img alt="导入的课程通知截图" hidden>' : ''}</details><form id="review-form">${taskFields(task, 'review-')}<div class="review-actions"><button class="text-button" type="button" id="skip-task">跳过这一项</button><button class="button button-primary" type="submit">确认并保存 ${icon('arrow')}</button></div></form>`;
    $('#review-form', panel).dataset.id = task.id;
    lastPreviewId = null; preview(task.sourceId).catch(() => {});
    panel.oninput = () => persist();
    $('#skip-task', panel).onclick = () => ui.safely(async () => { await consume(null, task.id, true); showDraft(); });
    $('#review-form', panel).onsubmit = event => {
      event.preventDefault();
      const candidate = readTaskFields(event.currentTarget, task);
      const error = validateTask(candidate);
      if (error) { $('#review-form-error', panel).textContent = error; return; }
      ui.saveWithChecks(candidate, { persistTask: candidate => consume(candidate, task.id), afterSave: showDraft, onSkip: () => ui.safely(async () => { await consume(null, task.id, true); showDraft(); }) });
    };
    goTo('review');
    if (!task.dateConfirmed) ui.confirmDate(task, confirmed => { if (!alive) return; model.tasks[0] = confirmed; showDraft(); persist(); }, changed => {
      if (!alive) return;
      Object.assign(task, changed);
      for (const name of ['dueDate', 'dueTime']) $('#review-form', panel).elements[name].value = changed[name];
      persist();
    });
  }
  function queueView(message = '正在准备本地识别', progress = 0) {
    const done = model.sources.filter(source => ['done', 'skipped', 'failed'].includes(source.status)).length;
    panel.oninput = null;
    panel.innerHTML = `<div class="review-placeholder"><div class="scan-loader">${icon('scan')}</div><h3 id="ocr-message">${esc(message)}</h3><p id="queue-progress">${done} / ${model.sources.length} 张已处理</p><div class="ocr-progress"><i id="ocr-bar" style="width:${Math.max(3, progress * 100)}%"></i></div><p>逐张识别，完成后汇总确认。中断后可从本机草稿继续。</p><button class="text-button" id="cancel-ocr">暂停并退出</button></div>`;
    $('#cancel-ocr', panel).onclick = () => ui.exit(returnView);
  }
  async function runQueue() {
    if (busy || !alive) return;
    busy = true; raw.disabled = true; $('#extract-tasks', element).disabled = true;
    queueView(); goTo('review');
    try {
      ocr = await import('./ocr.js');
      for (const source of model.sources) {
        if (!alive) return;
        if (source.status !== 'pending') continue;
        source.status = 'running'; filesList(); queueView(`正在识别：${source.name}`);
        await persist(true);
        try {
          const file = await loadDraftFile(source.id);
          if (!file) throw new Error('暂存截图已不可用，请重新选择这张图片。');
          const result = await ocr.recognizeImage(file.blob, (message, progress) => {
            if (!alive) return;
            $('#ocr-message', panel).textContent = `${source.name}：${message}`;
            $('#ocr-bar', panel).style.width = `${Math.max(3, Math.round(progress * 100))}%`;
          }, { accuracy: model.accuracy });
          if (!alive) return;
          if (!result.text.trim()) throw new Error('没有识别到文字，可重试或跳过这张截图。');
          source.text = result.text; source.status = 'done'; delete source.error;
          source.engine = result.engine;
          if (result.warning) source.warning = result.warning;
          model.tasks.push(...extractTasks(result.text, new Date(source.referenceTime || model.referenceTime)).map(task => ({ ...task, sourceId: source.id, selected: true })));
          if (Number.isFinite(result.confidence) && result.confidence < 65) source.warning = '部分文字不清楚，请核对日期和要求。';
        } catch (error) {
          if (!alive) return;
          source.status = 'failed'; source.error = error.message;
        }
        model.text = raw.value = [model.extraText, ...model.sources.filter(source => source.status === 'done').map(source => source.text)].filter(Boolean).join('\n\n');
        await persist(true);
      }
      if (!alive) return;
      model.overview = model.sources.length > 1 || (!!model.extraText && model.tasks.length > 1);
      if (model.tasks.length) { await persist(true); showDraft(); }
      else { panel.innerHTML = `<div class="review-placeholder import-error"><h3>这次没有识别完成</h3>${failures()}<p>可返回修改原文，粘贴通知文字后继续提取。</p></div>`; bindFailures(); }
    } catch (error) {
      if (alive) {
        for (const source of model.sources) if (source.status === 'running') source.status = 'pending';
        queueView('处理暂停：' + error.message);
        status('草稿尚未保存成功，请重试或返回修改。', true);
        const retry = document.createElement('button'); retry.className = 'button button-light'; retry.textContent = '重试保存并继续';
        retry.onclick = runQueue; $('.review-placeholder', panel).append(retry);
      }
    } finally {
      busy = false; raw.disabled = false; $('#extract-tasks', element).disabled = false;
      if (alive) flow.setStage(model.stage);
    }
  }
  async function handleFiles(list) {
    if (busy || saving || !alive) return;
    const files = [...list];
    const error = validateImages(files);
    if (error) { ui.toast(error, true); return; }
    if (hasImportDraft(model) && !window.confirm('更换截图会替换尚未保存的草稿，已保存的任务不受影响。继续吗？')) return;
    const sources = files.map(file => ({ id: newId(), name: file.name, status: 'pending', text: '' }));
    completed = false;
    updateReference();
    Object.assign(model, { text: '', extraText: '', tasks: [], sources, saved: 0, skipped: 0, overview: files.length > 1, stage: 'review' }); raw.value = '';
    try {
      await serial(() => replaceImportDraft(snapshot(), files.map((blob, index) => ({ id: sources[index].id, blob }))));
      ui.onDraft(snapshot()); filesList(); runQueue();
    } catch (error) { status(`截图暂存失败：${error.message} 请减少截图数量后重试。`, true); }
  }
  function extract() {
    if (busy || saving) return;
    if (model.tasks.length && !window.confirm('重新提取会替换尚未确认的结果，已保存的任务不受影响。继续吗？')) return;
    model.text = raw.value;
    if (!model.text.trim()) { ui.toast('请先上传截图或粘贴通知文字。', true); return; }
    updateReference();
    model.tasks = extractTasks(model.text, new Date(model.referenceTime)).map(task => ({ ...task, selected: true }));
    completed = false;
    for (const source of model.sources) if (source.status === 'failed') source.status = 'skipped';
    model.saved = model.skipped = 0;
    persist(); showDraft();
  }
  raw.oninput = () => persist();
  $('#extract-tasks', element).onclick = extract;
  $('#back-to-source', element).onclick = () => { remember(); goTo('capture'); persist(); };
  $('#continue-review', element).onclick = () => model.sources.some(source => source.status === 'pending') ? runQueue() : showDraft();
  $('#screenshot-file', element).onchange = event => { const files = [...event.target.files]; event.target.value = ''; handleFiles(files); };
  const drop = $('#image-drop', element);
  drop.onclick = () => { if (!busy) $('#screenshot-file', element).click(); };
  drop.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); drop.click(); } };
  drop.ondragover = event => { event.preventDefault(); drop.classList.add('drag-over'); };
  drop.ondragleave = () => drop.classList.remove('drag-over');
  drop.ondrop = event => { event.preventDefault(); drop.classList.remove('drag-over'); handleFiles(event.dataTransfer.files); };
  if (model.mode === 'voice') { drop.hidden = true; $('.source-panel > h3', element).firstChild.textContent = '语音转写 '; }
  const flow = {
    element, returnView,
    canReview: () => model.tasks.length > 0 || model.sources.length > 0 || busy || completed || model.saved > 0 || model.skipped > 0,
    setStage(stage) {
      if (stage !== 'review') remember();
      model.stage = stage;
      for (const input of $$('input, select, button', options)) input.disabled = busy || saving;
      sourcePanel.hidden = stage === 'review'; panel.hidden = stage !== 'review';
      $('#back-to-source', element).hidden = stage !== 'review'; $('#back-to-source', element).disabled = busy || saving;
      $('#continue-review', element).hidden = stage === 'review' || (!model.tasks.length && !model.sources.length);
      $$('.import-steps span', element).forEach((node, index) => node.classList.toggle('active', index === (stage === 'review' ? (busy ? 1 : 2) : 0)));
    },
    dispose() { remember(); const pending = persist(); alive = false; ocr?.cancelOCR(); releaseImages(); element.remove(); return pending; },
    open() {
      filesList();
      if (restored && model.stage === 'review') {
        if (model.sources.some(source => source.status === 'pending')) runQueue(); else showDraft();
      } else { goTo('capture', true); if (initialText) extract(); }
    },
  };
  return flow;
}
