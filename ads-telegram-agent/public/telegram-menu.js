let menuDraft, menuBase, menuRevision, menuDirty = false, menuSaving = false, menuReloading = false;
const menuActionNames = {refresh:'Cập nhật báo cáo',dates:'Chọn ngày',groups:'Đổi nhóm',campaigns:'Chi tiết campaign',products:'Sản phẩm bán chạy',reconciliation:'Đối soát đơn hàng',insights:'Nhận định bán hàng',request:'Chạy yêu cầu đã lưu',web:'Mở báo cáo trên web',settings:'Mở cài đặt lịch gửi',url:'Mở liên kết HTTPS'};
function menuDefaultDraft() {
  return {enabled:true,columns:2,buttons:[['refresh','🔄 Cập nhật'],['dates','📅 Chọn ngày'],['campaigns','📣 Campaign'],['products','📦 Sản phẩm'],['reconciliation','🔎 Đối soát'],['insights','💡 Nhận định'],['groups','🗂 Đổi nhóm'],['settings','⚙️ Cài lịch gửi'],['web','🌐 Mở báo cáo trên web']].map(([action,label])=>({id:action,action,label,enabled:true,groupMode:'current',dateMode:'current',fullRow:action==='web'}))};
}
function menuBusy(data=state) {
  const disabled=!data.canEditGroups || menuSaving || menuReloading;
  for(const id of ['menuFields','menuSave','menuReload']) {
    const locked=id==='menuReload' ? menuSaving || menuReloading : disabled;
    $(id).disabled=locked;$(id).toggleAttribute('disabled',locked);
  }
}
function menuChanged() {
  menuDirty = true; $('menuDirty').textContent = 'Chưa lưu'; $('menuDirty').className = 'pill warn';
  feedback('menuFeedback'); renderMenuPreview();
}
function setupTelegramMenu(data) {
  menuBusy(data);
  if (menuDirty || menuSaving || menuReloading || data.revision < (menuRevision ?? -1)) return;
  menuDraft = structuredClone(data.telegramMenu || menuDefaultDraft());
  menuBase = JSON.stringify(menuDraft); menuRevision = data.revision;
  $('menuEnabled').checked = menuDraft.enabled; $('menuColumns').value = String(menuDraft.columns);
  const old = $('menuPreviewGroup').value;
  $('menuPreviewGroup').replaceChildren(...data.groups.map(g=>Object.assign(el('option',g.name),{value:g.id})));
  $('menuPreviewGroup').value = data.groups.some(g=>g.id===old) ? old : data.groups[0]?.id || '';
  $('menuDirty').textContent = 'Đã lưu'; $('menuDirty').className = 'pill';
  renderMenuCards();
}
function menuControl(title,node) {const label=el('label',title);label.append(node);return label;}
function menuInput(button,index,field,type='text') {
  const input=el('input');input.type=type;input.dataset.menuField=field;input.id='menu-'+button.id+'-'+field;
  if(type==='checkbox')input.checked=button[field];else input.value=button[field] || '';
  if(field==='label'){input.required=true;input.maxLength=48;}
  if(field==='url'){input.required=button.action==='url';input.type='url';input.maxLength=500;input.placeholder='https://…';input.pattern='https://.*';}
  input.oninput=()=>{button[field]=type==='checkbox'?input.checked:input.value;menuChanged();};
  return input;
}
function menuSelect(button,field,choices) {
  const select=el('select');select.dataset.menuField=field;select.setAttribute('aria-label',({action:'Hành động',requestId:'Yêu cầu đã lưu',groupMode:'Nhóm sử dụng',groupId:'Nhóm cố định',dateMode:'Khoảng ngày'})[field]);
  select.replaceChildren(...choices.map(([value,label])=>Object.assign(el('option',label),{value})));
  select.value=button[field] || choices[0]?.[0] || '';
  select.onchange=()=>{
    button[field]=select.value;
    if(field==='action'&&select.value==='request'){
      button.requestId=state.requests[0]?.id;button.dateMode='request';
    }
    if(field==='groupMode'&&select.value==='fixed')button.groupId=state.groups[0]?.id;
    if(field==='requestId'&&!state.requests.find(r=>r.id===select.value)?.allowDate)button.dateMode='request';
    menuChanged();renderMenuCards();
  };
  return select;
}
function renderMenuCards() {
  $('menuAdd').disabled = menuDraft.buttons.length >= 20;
  $('menuButtonCount').textContent = menuDraft.buttons.length + '/20';
  $('menuButtonList').replaceChildren(...menuDraft.buttons.map((button,index)=>{
    const card=el('section',undefined,'menuButtonCard');card.setAttribute('aria-label','Nút '+(index+1));
    const head=el('div',undefined,'menuButtonHead'), enabled=menuInput(button,index,'enabled','checkbox');
    const enabledLabel=menuControl('Bật nút',enabled);enabledLabel.className='checkLabel';
    const controls=el('div',undefined,'menuOrderActions');
    for(const [text,title,delta] of [['↑','Đưa nút lên',-1],['↓','Đưa nút xuống',1]]){
      const move=el('button',text,'secondary');move.type='button';move.setAttribute('aria-label',title+' '+button.label);
      move.dataset[delta===-1?'menuUp':'menuDown']=String(index);move.disabled=index+delta<0||index+delta>=menuDraft.buttons.length;
      move.onclick=()=>{[menuDraft.buttons[index],menuDraft.buttons[index+delta]]=[menuDraft.buttons[index+delta],menuDraft.buttons[index]];menuChanged();renderMenuCards();};controls.append(move);
    }
    const remove=el('button','Xóa','quietDanger');remove.type='button';remove.dataset.menuRemove=String(index);
    remove.onclick=()=>{menuDraft.buttons.splice(index,1);menuChanged();renderMenuCards();};controls.append(remove);head.append(enabledLabel,controls);
    const fields=el('div',undefined,'menuCardFields');
    fields.append(menuControl('Tên nút · gồm emoji',menuInput(button,index,'label')),
      menuControl('Khi bấm nút',menuSelect(button,'action',Object.entries(menuActionNames))));
    if(button.action==='request'){
      const requests=[['','Chọn yêu cầu'],...state.requests.map(r=>[r.id,r.name+(r.enabled?'':' · Đang tắt')])];
      if(button.requestId&&!state.requests.some(r=>r.id===button.requestId))requests.push([button.requestId,'Yêu cầu đã xóa · Chọn lại']);
      fields.append(menuControl('Yêu cầu đã lưu',menuSelect(button,'requestId',requests)),menuControl('Nhóm sử dụng',menuSelect(button,'groupMode',[['current','Nhóm của báo cáo đang xem'],['fixed','Chọn nhóm cố định']])));
      if(button.groupMode==='fixed')fields.append(menuControl('Nhóm cố định',menuSelect(button,'groupId',[['','Chọn nhóm'],...state.groups.map(g=>[g.id,g.name])])));
      const rule=state.requests.find(r=>r.id===button.requestId);
      fields.append(menuControl('Khoảng ngày',menuSelect(button,'dateMode',rule&&!rule.allowDate?[['request','Theo yêu cầu đã lưu']]:[['current','Giữ kỳ của báo cáo đang xem'],['request','Theo yêu cầu đã lưu'],['today','Hôm nay'],['yesterday','Hôm qua'],['last7','7 ngày gần nhất'],['month','Tháng này']])));
    }
    if(button.action==='url')fields.append(menuControl('Liên kết HTTPS',menuInput(button,index,'url')));
    const full=menuControl('Chiếm cả hàng',menuInput(button,index,'fullRow','checkbox'));full.className='checkLabel';
    card.append(head,fields,full);return card;
  }));
  if(!menuDraft.buttons.length)$('menuButtonList').append(el('p','Chưa có nút. Thêm nút đầu tiên để tạo menu.','hint'));
  renderMenuPreview();
}
function renderMenuPreview() {
  if(!menuDraft)return;
  const group=state.groups.find(g=>g.id===$('menuPreviewGroup').value),source=group?.report?.source || 'sheets';
  $('menuPreviewTitle').textContent = group?.name || 'Báo cáo';
  const buttons=menuDraft.enabled?menuDraft.buttons.filter(b=>{
    if(!b.enabled)return false;
    if(b.action==='campaigns'&&source==='sheets')return false;
    if(['products','reconciliation','insights'].includes(b.action)&&source!=='pancake')return false;
    if(b.action==='request'){
      const r=state.requests.find(r=>r.id===b.requestId&&r.enabled),g=b.groupMode==='fixed'?b.groupId:group?.id;
      return !!r&&(r.groupMode==='all'||r.groupIds.includes(g));
    }
    return true;
  }):[];
  const rows=[];let row=[];
  for(const b of buttons){if(b.fullRow){if(row.length)rows.push(row);rows.push([b]);row=[];}else{row.push(b);if(row.length===menuDraft.columns){rows.push(row);row=[];}}}if(row.length)rows.push(row);
  $('menuKeyboardPreview').replaceChildren(...rows.map(items=>{
    const line=el('div',undefined,'menuKeyboardRow');line.dataset.columns=String(items.length);
    for(const b of items){const node=el('button',b.label || 'Tên nút','menuPreviewButton');node.type='button';node.onclick=()=>feedback('menuPreviewFeedback',menuActionNames[b.action]+(b.action==='request'?' · '+(state.requests.find(r=>r.id===b.requestId)?.name||'Chọn yêu cầu'):'')+' · Bản mô phỏng, chưa gửi Telegram.');line.append(node);}return line;
  }));
  if(!buttons.length)$('menuKeyboardPreview').append(el('p',menuDraft.enabled?'Không có nút phù hợp với nguồn của nhóm này.':'Đang tắt nút dưới báo cáo.','hint'));
}
document.getElementById('commandTab').onclick=()=>{ $('requestCommandsPanel').hidden=false;$('telegramMenuPanel').hidden=true;$('commandTab').setAttribute('aria-pressed','true');$('menuTab').setAttribute('aria-pressed','false'); };
document.getElementById('menuTab').onclick=()=>{ $('requestCommandsPanel').hidden=true;$('telegramMenuPanel').hidden=false;$('menuTab').setAttribute('aria-pressed','true');$('commandTab').setAttribute('aria-pressed','false'); };
document.getElementById('menuEnabled').onchange=()=>{menuDraft.enabled=$('menuEnabled').checked;menuChanged();};
document.getElementById('menuColumns').onchange=()=>{menuDraft.columns=Number($('menuColumns').value);menuChanged();};
document.getElementById('menuPreviewGroup').onchange=renderMenuPreview;
document.getElementById('menuAdd').onclick=()=>{
  if(menuDraft.buttons.length>=20)return;
  menuDraft.buttons.push({id:crypto.randomUUID().slice(0,32),label:'Nút mới',action:'refresh',enabled:true,groupMode:'current',dateMode:'current',fullRow:false});
  menuChanged();renderMenuCards();$('menuButtonList').lastElementChild.querySelector('input[type="text"]')?.focus();
};
document.getElementById('menuReload').onclick=async()=>{
  if(menuSaving||menuReloading)return;
  if(menuDirty&&!confirm('Bỏ bản menu chưa lưu và tải cấu hình mới?'))return;
  menuReloading=true;menuBusy();
  try{const data=await api('state');
    if(data.revision < (menuRevision ?? -1))throw new Error('Máy chủ đang trả cấu hình cũ. Bản đang chỉnh vẫn được giữ; thử tải lại sau.');
    menuDirty=false;menuReloading=false;updateState(data);feedback('menuFeedback','Đã tải cấu hình mới.');
  }catch(error){feedback('menuFeedback',error.message,true);}
  finally{menuReloading=false;menuBusy();}
};
document.getElementById('telegramMenuForm').onsubmit=async event=>{
  event.preventDefault();if(menuSaving||menuReloading||!state.canEditGroups)return;
  menuSaving=true;menuBusy();
  try{
    const body={menu:structuredClone(menuDraft),revision:menuRevision};let saved;
    try{saved=await api('telegram-menu',body);}catch(error){
      if(!/đã thay đổi/.test(error.message))throw error;
      const latest=await api('state');
      if(JSON.stringify(latest.telegramMenu||menuDefaultDraft())!==menuBase)throw new Error('Menu đã được sửa ở cửa sổ khác. Bản đang chỉnh vẫn được giữ; tải cấu hình mới để kiểm tra trước khi lưu.');
      saved=await api('telegram-menu',{...body,revision:latest.revision});
    }
    menuDirty=false;menuRevision=saved.revision;menuBase=JSON.stringify(menuDraft);
    $('menuDirty').textContent='Đã lưu';$('menuDirty').className='pill';
    feedback('menuFeedback','Đã lưu. Báo cáo gửi tiếp theo sẽ có menu mới; bot dùng được ngay cả khi bạn đóng web.');
    try{menuSaving=false;updateState(await api('state'));}catch{feedback('menuFeedback','Đã lưu menu. Chưa tải lại được trạng thái; bấm Tải cấu hình mới để kiểm tra.');}
  }catch(error){feedback('menuFeedback',error.message,true);}
  finally{menuSaving=false;menuBusy();}
};
window.addEventListener('beforeunload',event=>{if(menuDirty){event.preventDefault();event.returnValue='';}});
