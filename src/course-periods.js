const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function tableWizardHTML(table) {
  return `<form id="course-table-form" class="course-form period-wizard-form"><div class="period-wizard-scroll"><div id="period-basic"><label>课表名称<input name="name" required maxlength="80" value="${esc(table.name)}"></label><label>第一教学周的星期一<input name="firstMonday" type="date" required value="${esc(table.firstMonday)}"></label><div class="course-form-row"><label>学期周数<input name="maxWeeks" type="number" min="1" max="60" required value="${table.maxWeeks}"></label><label>每天最多几节课<select name="periodCount">${Array.from({length:20},(_,i)=>`<option ${i+1===table.periods.length?'selected':''}>${i+1}</option>`).join('')}</select></label></div><p class="course-hint">下一步逐节设置作息。预填时间只是示例，请按学校时间修改。</p></div><div id="period-times" hidden><div class="period-page-title"><strong id="period-page-label"></strong><small>可手动填写，也可点击拨动选择</small></div><div id="period-rows"></div></div><p class="course-form-error" role="alert"></p></div><div class="course-flow-footer"><button type="button" class="button button-light" id="period-back" hidden>上一组</button><button type="submit" class="button button-primary" id="period-next">下一步：设置作息</button></div></form>`;
}
function normalizeTime(raw) {
  const m=String(raw).trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
  if(!m||+m[1]>23||+m[2]>59)throw new Error('时间请填写为 08:00 这样的格式。');
  return `${m[1].padStart(2,'0')}:${m[2].padStart(2,'0')}`;
}
export function bindTableWizard(dialog, table, nativeCall) {
  const form=dialog.querySelector('form'),basic=form.querySelector('#period-basic'),times=form.querySelector('#period-times'),rows=form.querySelector('#period-rows');
  let stage=0,page=0,periods=structuredClone(table.periods);
  function capture(){rows.querySelectorAll('[data-period]').forEach(row=>{const i=+row.dataset.period;periods[i]={start:row.querySelector('[data-time=start]').value,end:row.querySelector('[data-time=end]').value};});}
  function render(){
    basic.hidden=stage!==0;times.hidden=stage!==1;form.querySelector('#period-back').hidden=stage===0;
    const count=+form.elements.periodCount.value;
    if(stage===1){
      while(periods.length<count)periods.push({start:'',end:''});
      const from=page*4,to=Math.min(count,from+4);form.querySelector('#period-page-label').textContent=`设置第 ${from+1}—${to} 节 · 共 ${count} 节`;
      rows.innerHTML=periods.slice(from,to).map((p,index)=>{const i=from+index;return `<section class="period-row" data-period="${i}"><strong>第 ${i+1} 节</strong>${['start','end'].map((key,k)=>`<label>${k?'下课':'上课'}<span><input data-time="${key}" name="period${i}${key}" inputmode="text" aria-label="第${i+1}节${k?'下课':'上课'}时间" value="${esc(p[key])}" placeholder="08:00" maxlength="5"><button type="button" class="period-picker" data-pick="${key}" aria-label="选择第${i+1}节${k?'下课':'上课'}时间">◷</button></span></label>`).join('')}</section>`;}).join('');
      rows.querySelectorAll('[data-pick]').forEach(button=>button.onclick=async()=>{
        const input=button.closest('label').querySelector('input');button.disabled=true;
        try{const result=await nativeCall('coursePickTime',{time:input.value,title:input.getAttribute('aria-label')});if(result.time){input.value=result.time;capture();}}catch(error){form.querySelector('[role=alert]').textContent=error.message;}finally{button.disabled=false;}
      });
      form.querySelector('#period-next').textContent=to<count?'下一组':'保存课表';
    }else form.querySelector('#period-next').textContent='下一步：设置作息';
    form.querySelector('.period-wizard-scroll').scrollTop=0;
  }
  form.querySelector('#period-back').onclick=()=>{capture();if(page>0)page--;else stage=0;render();};
  dialog.shikeBack=()=>{if(stage===1){capture();if(page>0)page--;else stage=0;render();}else dialog.close();return true;};
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.shikeBack();});
  return {
    advance(){
      if(stage===0){if(!form.reportValidity())return false;stage=1;page=0;render();return false;}
      capture();for(const p of periods.slice(page*4,Math.min(+form.elements.periodCount.value,page*4+4))){p.start=normalizeTime(p.start);p.end=normalizeTime(p.end);if(p.start>=p.end)throw new Error('下课时间应晚于上课时间。');}
      if((page+1)*4<+form.elements.periodCount.value){page++;render();return false;}return true;
    },
    value(){capture();let previous='';const selected=periods.slice(0,+form.elements.periodCount.value).map(p=>{const start=normalizeTime(p.start),end=normalizeTime(p.end);if(start>=end||start<previous)throw new Error('作息应按时间递增，各节不能重叠。');previous=end;return{start,end};});return{name:form.elements.name.value.trim(),firstMonday:form.elements.firstMonday.value,maxWeeks:+form.elements.maxWeeks.value,periods:selected};}
  };
}
