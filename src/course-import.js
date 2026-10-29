import {recognizeImage,cancelOCR} from './ocr.js';
import {courseDraft} from './timetable-drafts.js';
import {reconcileCourseSources,parseWeeks,formatWeeks,DAYS} from './timetable-parse.js';
import {newId} from './domain.js';

export async function openCourseImport({tables,targetId,openDialog,esc,courseFields,commit,toast}) {
  let draft=await courseDraft('get')||{sources:[],mode:'auto',targetId,stage:'select',courseIndex:0,meetingIndex:0};
  draft.targetId=tables.some(t=>t.id===draft.targetId)?draft.targetId:targetId;
  draft.sources.forEach(s=>{if(s.status==='running')s.status='waiting';});
  if(!draft.stage)draft.stage=draft.sources.some(s=>s.items?.length)?'review':'select';
  let closed=false,processing=false,saving=false,writes=Promise.resolve(),work=Promise.resolve(),urls=[];
  const dialog=openDialog('导入课程截图','选择截图 → 本机识别 → 逐门确认','<div id="course-import-host"></div>',{wide:true,onClose:()=>{closed=true;if(processing)cancelOCR();urls.forEach(URL.revokeObjectURL);}});
  dialog.classList.add('native-flow-screen','course-import-screen');
  const host=dialog.querySelector('#course-import-host'),$=s=>host.querySelector(s);
  const safe=action=>async()=>{try{await action();}catch(e){if(!closed){const el=$('.course-form-error');if(el)el.textContent=e.message;toast(e.message,true);}}};
  const persist=()=>{const snapshot=structuredClone(draft);writes=writes.catch(()=>{}).then(()=>courseDraft('put',snapshot));return writes;};
  const groups=()=>{const result=new Map();for(const source of draft.sources)for(const item of source.items||[]){const key=item.courseCode||item.name;if(!result.has(key))result.set(key,[]);result.get(key).push({item,source});}return [...result.values()];};
  const sourceCount=()=>draft.sources.reduce((n,s)=>n+(s.items?.length||0),0);
  dialog.shikeBack=()=>{if(draft.stage==='review'){if(draft.courseIndex>0){draft.courseIndex--;draft.meetingIndex=0;}else draft.stage='select';persist().then(render).catch(e=>toast(e.message,true));}else dialog.close();return true;};
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.shikeBack();});
  function showOriginal(source){
    if(!source.file)return;
    const url=URL.createObjectURL(source.file),preview=openDialog('对照原图',source.name,`<img class="course-original" src="${url}" alt="课程截图原图">`,{wide:true,onClose:()=>URL.revokeObjectURL(url)});preview.classList.add('course-original-dialog');
  }
  async function process(){
    if(processing)return;processing=true;draft.stage='select';render();
    try{
      for(const source of draft.sources){
        if(!source.contentHash&&source.file){const digest=await crypto.subtle.digest('SHA-256',await source.file.arrayBuffer());source.contentHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
        if(closed)break;
        if(source.status==='done')continue;
        const duplicate=source.contentHash&&draft.sources.find(s=>s!==source&&s.status==='done'&&s.contentHash===source.contentHash);
        if(duplicate){Object.assign(source,structuredClone({text:duplicate.text,lines:duplicate.lines,table:duplicate.table}),{status:'done',mode:draft.mode,textEdited:!!duplicate.textEdited,elapsedMs:0,reused:true});await persist();continue;}
        source.status='running';source.error='';await persist();render();
        try{
          const result=await recognizeImage(source.file,(message,progress)=>{const el=$('#course-ocr-progress');if(el)el.textContent=`${source.name} · ${message} ${Math.round(progress*100)}%`;},{layout:true});
          Object.assign(source,{text:result.text,lines:result.lines,table:result.table,status:'done',mode:draft.mode,textEdited:false,elapsedMs:result.elapsedMs,cacheHits:result.cacheHits,recognitions:result.recognitions});await persist();
          if(closed)break;
        }catch(e){source.status='waiting';source.error=e.message;await persist();break;}
      }
      if(!closed&&draft.sources.length&&draft.sources.every(s=>s.status==='done')){
        reconcileCourseSources(draft.sources);draft.courseIndex=0;draft.meetingIndex=0;draft.stage=sourceCount()?'review':'select';await persist();
      }
    }finally{processing=false;if(!closed)render();}
  }
  function render(){
    if(closed)return;urls.forEach(URL.revokeObjectURL);urls=[];
    if(draft.stage==='review'&&groups().length){renderReview();return;}
    host.innerHTML=`<div class="course-flow-scroll"><div class="course-import-options course-form"><label>保存到课表<select id="course-import-target" ${processing?'disabled':''}>${tables.map(t=>`<option value="${esc(t.id)}" ${t.id===draft.targetId?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>截图类型<select id="course-import-mode" ${processing?'disabled':''}><option value="auto">自动判断</option><option value="grid">周课表</option><option value="list">课程列表 / 选课结果</option></select></label></div><label class="course-image-picker">＋ 选择课程截图<input id="course-images" type="file" accept="image/*" multiple hidden ${processing?'disabled':''}></label><p class="course-hint">支持多张截图，保留表头和完整上课安排。重叠内容会合并，识别后逐门确认。</p><div class="course-source-compact">${draft.sources.map((s,i)=>`<div><span><strong>${esc(s.name)}</strong><small>${s.status==='done'?(s.reused?'重复图片，已复用识别':s.elapsedMs?'已识别 · '+(s.elapsedMs/1000).toFixed(1)+' 秒':'已识别'):s.status==='running'?'正在识别':s.error||'等待识别'}</small></span><button type="button" class="icon-button" data-remove="${i}" ${processing?'disabled':''} aria-label="移除${esc(s.name)}">×</button></div>`).join('')}</div><p id="course-ocr-progress" role="status">${processing?'正在识别，请稍候':sourceCount()?`已整理 ${groups().length} 门课程 · ${sourceCount()} 个安排`:'请选择课程表或课程列表截图'}</p><p class="course-form-error" role="alert"></p></div><div class="course-flow-footer"><button type="button" class="button button-light" id="course-import-clear" ${processing?'disabled':''}>清空草稿</button>${processing?'<button class="button button-light" id="course-import-stop">暂停识别</button>':`<button class="button button-primary" id="course-import-run" ${!draft.sources.length?'disabled':''}>${sourceCount()&&draft.sources.every(s=>s.status==='done')?'继续逐门确认':'开始 / 继续识别'}</button>`}</div>`;
    $('#course-import-mode').value=draft.mode;
    $('#course-import-target').onchange=safe(async()=>{draft.targetId=$('#course-import-target').value;await persist();});
    $('#course-import-mode').onchange=safe(async()=>{draft.mode=$('#course-import-mode').value;await persist();});
    $('#course-images').onchange=safe(async()=>{
      const files=[...$('#course-images').files];if(draft.sources.length+files.length>10)throw new Error('一次最多选择 10 张截图。');if(files.some(f=>f.size>20000000))throw new Error('单张截图超过 20 MB，请裁剪后再试。');
      for(const file of files)draft.sources.push({id:newId(),name:file.name,file,status:'waiting',text:'',items:[]});await persist();work=process();await work;
    });
    host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=safe(async()=>{draft.sources.splice(+b.dataset.remove,1);await persist();render();}));
    $('#course-import-run')?.addEventListener('click',safe(async()=>{if(sourceCount()&&draft.sources.every(s=>s.status==='done')){draft.stage='review';await persist();render();}else{work=process();await work;}}));
    $('#course-import-stop')?.addEventListener('click',()=>cancelOCR());
    $('#course-import-clear').onclick=()=>{
      const confirm=openDialog('清空识别草稿？','',`<p>本次截图和候选内容将移除，已保存的课程不受影响。</p><button class="button button-primary" id="course-clear-confirm">确认清空</button>`);
      confirm.querySelector('button#course-clear-confirm').onclick=safe(async()=>{await writes;await courseDraft('delete');draft={sources:[],mode:'auto',targetId:draft.targetId,stage:'select',courseIndex:0,meetingIndex:0};confirm.close();render();});
    };
  }
  function renderReview(){
    const list=groups();draft.courseIndex=Math.min(Math.max(0,draft.courseIndex||0),list.length-1);const group=list[draft.courseIndex];draft.meetingIndex=Math.min(Math.max(0,draft.meetingIndex||0),group.length-1);
    const {item,source}=group[draft.meetingIndex],last=draft.courseIndex===list.length-1,target=tables.find(t=>t.id===draft.targetId);
    host.innerHTML=`<div class="course-review-progress"><span>第 ${draft.courseIndex+1} / ${list.length} 门课程</span><strong>${esc(item.name||'待补充课程')}</strong><small>共 ${sourceCount()} 个上课安排 · 重叠截图已合并</small></div><form id="course-import-confirm" class="course-form"><div class="course-flow-scroll"><div class="course-review-tools"><button type="button" class="text-button" id="course-view-original" ${!source.file?'disabled':''}>对照原图</button><button type="button" class="text-button" id="course-back-images">返回选图</button></div>${group.length>1?`<label class="course-meeting-select">本课程上课安排<select id="course-meeting-select" aria-label="选择本课程上课安排">${group.map(({item:c},i)=>`<option value="${i}" ${i===draft.meetingIndex?'selected':''}>${i+1}/${group.length} · ${DAYS[c.day]||'待补充'} · 第${c.start||'?'}—${c.end||'?'}节 · ${typeof c.weeks==='string'?esc(c.weeks):formatWeeks(c.weeks)}周</option>`).join('')}</select></label>`:''}<div class="course-candidates"><fieldset data-source="${item.sourceIndex||0}"><legend>课程与本次安排</legend>${courseFields(item,target?.maxWeeks||60)}</fieldset></div>${(item.warnings||[]).map(w=>`<p class="course-warning">${esc(w)}</p>`).join('')}<p class="course-hint">${!item.day||!item.start||!item.weeks.length?'缺少的上课信息可稍后补全，当前不会安排提醒。':'确认后按课表作息换算实际时间。'}</p><p class="course-form-error" role="alert"></p></div><div class="course-flow-footer"><button type="button" class="button button-light" id="course-confirm-prev" ${draft.courseIndex===0?'disabled':''}>上一门</button><button type="button" class="text-button" id="course-confirm-skip">跳过本课程</button><button type="submit" class="button button-primary" id="course-confirm-next">${last?'确认并保存课程':'确认并下一门'}</button></div></form>`;
    const form=$('#course-import-confirm');
    const capture=()=>{
      const values=new FormData(form);for(const key of ['name','teacher'])for(const row of group)row.item[key]=String(values.get(key)||'').trim();
      for(const key of ['room','day','start','end','weeks'])item[key]=String(values.get(key)||'');
      group.forEach(row=>row.item.confirmed=false);
    };
    form.addEventListener('input',()=>{capture();persist().catch(e=>toast(e.message,true));});
    $('#course-view-original').onclick=()=>showOriginal(source);
    $('#course-back-images').onclick=safe(async()=>{capture();draft.stage='select';await persist();render();});
    $('#course-meeting-select')?.addEventListener('change',safe(async()=>{capture();draft.meetingIndex=+$('#course-meeting-select').value;await persist();render();}));
    $('#course-confirm-prev').onclick=safe(async()=>{capture();draft.courseIndex--;draft.meetingIndex=0;await persist();render();});
    async function advance(skip){
      if(saving)return;capture();
      for(const {item:c} of group){
        if(!skip){if(!c.name)throw new Error('请填写课程名称。');parseWeeks(typeof c.weeks==='string'?c.weeks:formatWeeks(c.weeks),target.maxWeeks);const start=+c.start,end=+c.end;if((start===0)!==(end===0)||end<start||end>target.periods.length)throw new Error('请核对节次，不能超出这份课表的作息范围。');}
        c.selected=!skip;c.confirmed=true;
      }
      if(!last){draft.courseIndex++;draft.meetingIndex=0;await persist();render();return;}
      const unconfirmed=list.findIndex(rows=>rows.some(r=>r.item.selected!==false&&!r.item.confirmed));
      if(unconfirmed>=0){draft.courseIndex=unconfirmed;draft.meetingIndex=0;await persist();render();toast('请确认这门课程的修改。');return;}
      const selected=draft.sources.flatMap(s=>s.items||[]).filter(c=>c.selected!==false);
      if(!selected.length)throw new Error('没有选择需要保存的课程。');
      saving=true;$('#course-confirm-next').disabled=true;
      try{await persist();await commit(selected.map(c=>({...c,day:+c.day,start:+c.start,end:+c.end,weeks:typeof c.weeks==='string'?parseWeeks(c.weeks,target.maxWeeks):c.weeks})),draft.targetId);await writes;await courseDraft('delete');dialog.close();}finally{saving=false;if(!closed)$('#course-confirm-next').disabled=false;}
    }
    form.onsubmit=e=>{e.preventDefault();safe(()=>advance(false))();};$('#course-confirm-skip').onclick=safe(()=>advance(true));
    $('.course-flow-scroll').scrollTop=0;
  }
  render();return {dialog,settled:()=>work.catch(()=>{})};
}
