import {DAY_PARTS,scheduleSettings,validatePeriodGroups,regroupPeriods,periodPart,timeMinutes,minutesTime} from './course-schedule.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function tableWizardHTML(table) {
  const {periodGroups,lessonMinutes}=scheduleSettings(table);
  return `<form id="course-table-form" class="course-form period-wizard-form"><div class="period-wizard-scroll"><div id="period-basic"><label>课表名称<input name="name" required maxlength="80" value="${esc(table.name)}"></label><label>第一教学周的星期一<input name="firstMonday" type="date" required value="${esc(table.firstMonday)}"></label><div class="course-form-row"><label>学期周数<input name="maxWeeks" type="number" min="1" max="60" required value="${table.maxWeeks}"></label><label>每节课时长（分钟）<input name="lessonMinutes" type="number" min="5" max="180" required value="${lessonMinutes}"></label></div><fieldset class="period-group-settings"><legend>一天的上课节数</legend><div class="course-form-row three">${DAY_PARTS.map(([key,label])=>`<label>${label}<select name="${key}Count" aria-label="${label}上课节数">${Array.from({length:21},(_,i)=>`<option value="${i}" ${i===periodGroups[key]?'selected':''}>${i} 节</option>`).join('')}</select></label>`).join('')}</div><p class="course-hint" id="period-total"></p></fieldset><p class="course-hint">下一步逐节设置作息，可手写或拨动选择。修改课长会按已填写的上课时间重算下课时间；每节仍可单独调整。</p></div><div id="period-times" hidden><div class="period-page-title"><strong id="period-page-label"></strong><small id="period-duration-label"></small></div><div id="period-rows"></div></div><p class="course-form-error" role="alert"></p></div><div class="course-flow-footer"><button type="button" class="button button-light" id="period-back" hidden>上一组</button><button type="submit" class="button button-primary" id="period-next">下一步：设置作息</button></div></form>`;
}
export function bindTableWizard(dialog,table,nativeCall) {
  const form=dialog.querySelector('form'),basic=form.querySelector('#period-basic'),times=form.querySelector('#period-times'),rows=form.querySelector('#period-rows');
  let stage=0,page=0,periods=structuredClone(table.periods),{periodGroups,lessonMinutes}=scheduleSettings(table);
  const groups=()=>Object.fromEntries(DAY_PARTS.map(([key])=>[key,+form.elements[`${key}Count`].value]));
  const count=()=>validatePeriodGroups(periodGroups);
  const error=e=>{form.querySelector('[role=alert]').textContent=e?.message||'';};
  function capture(){rows.querySelectorAll('[data-period]').forEach(row=>{const i=+row.dataset.period;periods[i]={start:row.querySelector('[data-time=start]').value,end:row.querySelector('[data-time=end]').value};});}
  function updateEnd(row){try{const input=row.querySelector('[data-time=start]');row.querySelector('[data-time=end]').value=minutesTime(timeMinutes(input.value)+lessonMinutes);capture();error();}catch(e){error(e);}}
  const updateTotal=()=>{const g=groups();form.querySelector('#period-total').textContent=`每天共 ${DAY_PARTS.reduce((n,[key])=>n+g[key],0)} 节；某个时段没有课可选 0 节。`;};
  DAY_PARTS.forEach(([key])=>form.elements[`${key}Count`].onchange=updateTotal);updateTotal();
  function render(){
    basic.hidden=stage!==0;times.hidden=stage!==1;form.querySelector('#period-back').hidden=stage===0;error();
    if(stage===1){
      const from=page*4,to=Math.min(count(),from+4);form.querySelector('#period-page-label').textContent=`设置第 ${from+1}—${to} 节 · 共 ${count()} 节`;
      form.querySelector('#period-duration-label').textContent=`每节 ${lessonMinutes} 分钟 · 修改上课时间会自动填写下课时间`;
      rows.innerHTML=periods.slice(from,to).map((p,index)=>{const i=from+index;return `<section class="period-row" data-period="${i}"><strong><small>${periodPart(i,periodGroups)}</small>第 ${i+1} 节</strong>${['start','end'].map((key,k)=>`<label>${k?'下课':'上课'}<span><input data-time="${key}" name="period${i}${key}" inputmode="text" aria-label="第${i+1}节${k?'下课':'上课'}时间" value="${esc(p[key])}" placeholder="08:00" maxlength="5"><button type="button" class="period-picker" data-pick="${key}" aria-label="选择第${i+1}节${k?'下课':'上课'}时间">◷</button></span></label>`).join('')}</section>`;}).join('');
      rows.querySelectorAll('[data-time=start]').forEach(input=>input.onchange=()=>updateEnd(input.closest('[data-period]')));
      rows.querySelectorAll('[data-pick]').forEach(button=>button.onclick=async()=>{
        const input=button.closest('label').querySelector('input');button.disabled=true;
        try{const result=await nativeCall('coursePickTime',{time:input.value,title:input.getAttribute('aria-label')});if(result.time){input.value=result.time;if(button.dataset.pick==='start')updateEnd(button.closest('[data-period]'));capture();}}catch(e){error(e);}finally{button.disabled=false;}
      });
      form.querySelector('#period-next').textContent=to<count()?'下一组':'保存课表';
    }else form.querySelector('#period-next').textContent='下一步：设置作息';
    form.querySelector('.period-wizard-scroll').scrollTop=0;
  }
  const back=()=>{capture();if(page>0)page--;else stage=0;render();};
  form.querySelector('#period-back').onclick=back;
  dialog.shikeBack=()=>{if(stage===1)back();else dialog.close();return true;};
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.shikeBack();});
  return {
    advance(){
      if(stage===0){
        if(!form.reportValidity())return false;const next=groups();validatePeriodGroups(next);
        const duration=+form.elements.lessonMinutes.value;if(!Number.isInteger(duration)||duration<5||duration>180)throw new Error('课长应为 5 至 180 分钟的整数。');
        const nextPeriods=regroupPeriods(periods,periodGroups,next);
        if(duration!==lessonMinutes)for(const p of nextPeriods)if(p.start)p.end=minutesTime(timeMinutes(p.start)+duration);
        periods=nextPeriods;periodGroups=next;lessonMinutes=duration;stage=1;page=0;render();return false;
      }
      capture();for(const p of periods.slice(page*4,Math.min(count(),page*4+4))){p.start=minutesTime(timeMinutes(p.start));p.end=minutesTime(timeMinutes(p.end));if(p.start>=p.end)throw new Error('下课时间应晚于上课时间。');}
      if((page+1)*4<count()){page++;render();return false;}return true;
    },
    value(){capture();let previous='';const selected=periods.map(p=>{const start=minutesTime(timeMinutes(p.start)),end=minutesTime(timeMinutes(p.end));if(start>=end||start<previous)throw new Error('作息应按时间递增，各节不能重叠。');previous=end;return{start,end};});return{name:form.elements.name.value.trim(),firstMonday:form.elements.firstMonday.value,maxWeeks:+form.elements.maxWeeks.value,lessonMinutes,periodGroups:{...periodGroups},periods:selected};}
  };
}
