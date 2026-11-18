"use strict";
let bcEditing, bcRevision, bcDirty=false, bcBusy=false, bcVersion=0, bcFieldVersion=0, bcFields=[], bcLedgerPage=0;
const bcTime=value=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa hoàn tất';
function setupBotcake(data){
  if(!document.getElementById('bcForm'))buildBotcakeUI();
  const connections=data.botcakeConnections||[];
  builderSelect($('bcSaved'),connections,$('bcSaved').value,'+ Kết nối Page mới');
  if(!bcDirty&&!bcBusy)fillBotcakeConnection();
  const page=$('bcPage').value;
  builderSelect($('bcPage'),connections.map(c=>({id:c.pageId,name:c.name+' · '+c.pageId})),page,'Chọn Page');
  if(page!==$('bcPage').value)clearBotcakeStatus();
  $('bcDatabaseNote').textContent=data.databaseConfigured?'Dùng kho PostgreSQL riêng của ứng dụng. Khởi tạo trước khi tính SĐT mới.':'Cần cấu hình DATABASE_URL trong Vercel trước khi lưu Botcake.';
  $('bcConnectionFields').disabled=!data.canEditGroups||bcBusy;
}
function buildBotcakeUI(){
  $('botcakeSources').innerHTML=`<div class="builderGrid bcWorkspace"><section class="panel builderPanel"><div class="sectionLine"><h2>Kết nối Botcake</h2><span class="pill">SĐT hồ sơ · chỉ đọc</span></div><p class="hint">Đọc phone_number và Custom Field đã chọn. Không đọc nội dung tin nhắn.</p><form id="bcForm"><fieldset id="bcConnectionFields"><label for="bcSaved">Kết nối đã lưu</label><select id="bcSaved"></select><div class="mappingGrid"><label>Tên kết nối<input id="bcName" maxlength="80" required></label><label>Page ID<input id="bcPageId" inputmode="numeric" pattern="[0-9]{1,30}" maxlength="30" required></label></div><label for="bcToken">Token API của Page Botcake</label><input id="bcToken" type="password" maxlength="4096" autocomplete="off" spellcheck="false"><p class="hint">Token chỉ được lưu trên máy chủ. Để trống khi giữ token cũ; đổi token không xóa lịch sử.</p><label for="bcSource">Lấy SĐT từ</label><select id="bcSource"><option value="profile">Hồ sơ · phone_number</option><option value="custom">Custom Fields đã chọn</option><option value="both">Hồ sơ + Custom Fields</option></select><div id="bcCustomFields" hidden><button id="bcLoadFields" class="secondary" type="button">Tải danh sách Custom Fields</button><p class="hint">Chỉ chọn trường lưu SĐT; tối đa 5 trường. Đổi nguồn/trường sẽ khởi tạo nền cho các số chưa biết.</p><label for="bcFieldSelect">Custom Field</label><select id="bcFieldSelect"></select><button id="bcAddField" class="secondary" type="button">+ Chọn trường</button><div id="bcSelectedFields" class="bcSelectedFields"></div></div><p class="hint">Quốc gia mặc định: Việt Nam (+84). Số quốc tế dùng mã +. Múi giờ: Asia/Ho_Chi_Minh.</p><div class="bcRule"><b>Chống trùng theo Page, kể cả khác ngày</b><p>Lần đầu nhập các số có sẵn làm dữ liệu nền. Khách quay lại cùng Page không được cộng lại. Gỡ/kết nối lại vẫn giữ sổ chống trùng.</p></div><div class="builderActions"><button id="bcSave" class="primary">Kiểm tra &amp; lưu kết nối</button><button id="bcRemove" type="button" class="secondary" hidden>Gỡ kết nối</button></div></fieldset></form><p id="bcFeedback" class="feedback" role="status"></p></section><section class="panel builderPanel"><h2>Đồng bộ &amp; sổ SĐT</h2><p class="hint" id="bcDatabaseNote"></p><button id="bcDatabaseCheck" class="secondary" type="button">Kiểm tra kho SĐT</button><p id="bcDatabaseFeedback" class="feedback" role="status"></p><label for="bcPage">Page đang xem</label><select id="bcPage"></select><div class="builderActions"><button id="bcSync" type="button" class="primary">Đồng bộ tiếp</button><button id="bcStatus" type="button" class="secondary">Xem trạng thái</button></div><p class="hint">GitHub Actions kiểm tra định kỳ mỗi 5 phút, có thể chậm theo hàng đợi GitHub. Tác vụ dài lưu tiến độ và tiếp tục ở lượt sau.</p><div id="bcSyncStatus" aria-live="polite"></div><p id="bcSyncFeedback" class="feedback" role="status"></p><details class="bcLedger"><summary>Sổ SĐT chống trùng</summary><p class="hint">SĐT được che. Ngày ghi nhận được giữ cố định; dữ liệu nền và số thiếu ngày hiển thị riêng, không tính thành số mới.</p><div class="mappingGrid"><label>Từ ngày<input id="bcFrom" type="date" required></label><label>Đến ngày<input id="bcTo" type="date" required></label></div><button id="bcLedgerLoad" class="secondary" type="button">Xem sổ SĐT</button><div id="bcLedgerRows"></div><div class="builderActions"><button id="bcPrev" type="button" class="secondary" disabled>Trang trước</button><span id="bcLedgerCount" class="hint"></span><button id="bcNext" type="button" class="secondary" disabled>Trang sau</button></div></details></section></div>`;
  $('bcFrom').value=$('bcTo').value=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  $('bcDatabaseCheck').onclick=async()=>{const b=$('bcDatabaseCheck');b.disabled=true;feedback('bcDatabaseFeedback','Đang kiểm tra database và kho SĐT…');try{const r=await api('botcake',{action:'health'},60000);feedback('bcDatabaseFeedback',r.message,!r.ready);}catch(e){feedback('bcDatabaseFeedback',e.message,true);}finally{b.disabled=false;}};
  $('bcForm').oninput=()=>{bcDirty=true;};
  $('bcSaved').onchange=()=>{if(bcDirty&&!confirm('Bỏ thay đổi kết nối Botcake chưa lưu?')){$('bcSaved').value=bcEditing||'';return;}bcDirty=false;fillBotcakeConnection();};
  $('bcSource').onchange=()=>{bcDirty=true;$('bcCustomFields').hidden=$('bcSource').value==='profile';};
  $('bcPageId').oninput=()=>{bcFields=[];renderBotcakeFields([]);bcFieldVersion++;$('bcLoadFields').disabled=false;};
  $('bcToken').oninput=()=>{bcFieldVersion++;$('bcLoadFields').disabled=false;};
  $('bcLoadFields').onclick=loadBotcakeFields;
  $('bcAddField').onclick=()=>{const id=Number($('bcFieldSelect').value);if(!id)return;const selected=botcakeFieldIds();if(!selected.includes(id)&&selected.length<5){selected.push(id);bcDirty=true;renderBotcakeFields(selected);}};
  $('bcForm').onsubmit=saveBotcakeConnectionUI;
  $('bcRemove').onclick=removeBotcakeConnectionUI;
  $('bcPage').onchange=clearBotcakeStatus;
  $('bcSync').onclick=()=>botcakeOperation('sync');$('bcStatus').onclick=()=>botcakeOperation('status');
  $('bcLedgerLoad').onclick=()=>{bcLedgerPage=0;botcakeOperation('ledger');};
  for(const id of ['bcFrom','bcTo'])$(id).onchange=()=>{bcVersion++;bcLedgerPage=0;$('bcLedgerRows').replaceChildren();$('bcLedgerCount').textContent='Khoảng ngày đã đổi. Bấm Xem sổ SĐT.';$('bcNext').disabled=$('bcPrev').disabled=true;};
  $('bcPrev').onclick=()=>{bcLedgerPage=Math.max(0,bcLedgerPage-1);botcakeOperation('ledger');};$('bcNext').onclick=()=>{bcLedgerPage++;botcakeOperation('ledger');};
  window.addEventListener('beforeunload',event=>{if(bcDirty){event.preventDefault();event.returnValue='';}});
}
function botcakeFieldIds(){return [...$('bcSelectedFields').querySelectorAll('[data-field-id]')].map(n=>Number(n.dataset.fieldId));}
function renderBotcakeFields(ids){
  builderSelect($('bcFieldSelect'),bcFields.filter(f=>!ids.includes(f.id)).map(f=>({id:String(f.id),name:f.name+' · '+f.id})),undefined,'Chọn Custom Field');
  $('bcSelectedFields').replaceChildren(...ids.map(id=>{const row=el('div',undefined,'bcFieldTag');row.dataset.fieldId=String(id);const button=el('button','Bỏ','secondary');button.type='button';button.setAttribute('aria-label','Bỏ trường '+id);button.onclick=()=>{bcDirty=true;renderBotcakeFields(botcakeFieldIds().filter(v=>v!==id));};row.append(el('span',(bcFields.find(f=>f.id===id)?.name||'Trường đã lưu')+' · '+id),button);return row;}));
}
function fillBotcakeConnection(){
  const c=state.botcakeConnections?.find(c=>c.id===$('bcSaved').value);bcEditing=c?.id;bcRevision=c?.revision;bcFields=c?.fields||[];bcFieldVersion++;
  $('bcName').value=c?.name||'';$('bcPageId').value=c?.pageId||'';$('bcPageId').readOnly=!!c;$('bcToken').value='';$('bcToken').required=!c;$('bcSource').value=c?.source||'profile';$('bcRemove').hidden=!c;$('bcCustomFields').hidden=$('bcSource').value==='profile';renderBotcakeFields(c?.fieldIds||[]);feedback('bcFeedback');
}
async function loadBotcakeFields(){
  const version=++bcFieldVersion,ids=botcakeFieldIds();$('bcLoadFields').disabled=true;feedback('bcFeedback','Đang đọc các trường của Page…');
  try{if(!/^\d{1,30}$/.test($('bcPageId').value))throw Error('Nhập Page ID bằng dãy số.');const r=await api('botcake',{action:'fields',pageId:$('bcPageId').value,token:$('bcToken').value.trim()},25000);if(version!==bcFieldVersion)return;bcFields=r.fields;renderBotcakeFields(ids);feedback('bcFeedback','Đã tải '+r.fields.length+' trường. Chọn trường lưu SĐT.');}
  catch(e){if(version===bcFieldVersion)feedback('bcFeedback',e.message,true);}finally{if(version===bcFieldVersion)$('bcLoadFields').disabled=false;}
}
async function saveBotcakeConnectionUI(event){
  event.preventDefault();if(bcBusy)return;bcBusy=true;$('bcConnectionFields').disabled=true;feedback('bcFeedback','Đang xác nhận quyền đọc Page và lưu kết nối…');
  try{const fieldIds=$('bcSource').value==='profile'?[]:botcakeFieldIds();if($('bcSource').value!=='profile'&&!fieldIds.length)throw Error('Chọn ít nhất một Custom Field lưu SĐT.');const id=bcEditing||'botcake-'+crypto.randomUUID().slice(0,12);
    const r=await api('botcake',{action:'save',id,revision:bcRevision,name:$('bcName').value.trim(),pageId:$('bcPageId').value.trim(),token:$('bcToken').value.trim(),source:$('bcSource').value,fieldIds},60000);
    $('bcToken').value='';bcDirty=false;bcEditing=id;bcBusy=false;
    updateState({...state,botcakeConnections:r.connections});$('bcSaved').value=id;fillBotcakeConnection();$('bcPage').value=r.connection.pageId;
    feedback('bcFeedback','Đã lưu. Bấm Đồng bộ tiếp để khởi tạo dữ liệu nền; sau đó thêm Page và chỉ số vào mẫu báo cáo.');
  }catch(e){feedback('bcFeedback',e.message,true);}finally{bcBusy=false;$('bcConnectionFields').disabled=!state.canEditGroups;}
}
async function removeBotcakeConnectionUI(){
  if(bcBusy||!bcEditing||!confirm('Gỡ kết nối Botcake? Lịch sử chống trùng được giữ; bỏ Page khỏi mẫu trước khi gỡ.'))return;
  bcBusy=true;$('bcConnectionFields').disabled=true;
  try{const r=await api('botcake',{action:'remove',id:bcEditing,revision:bcRevision});bcDirty=false;bcEditing=undefined;bcBusy=false;updateState({...state,botcakeConnections:r.connections});$('bcSaved').value='';fillBotcakeConnection();feedback('bcFeedback','Đã gỡ kết nối, giữ nguyên sổ chống trùng.');}
  catch(e){feedback('bcFeedback',e.message,true);}finally{bcBusy=false;$('bcConnectionFields').disabled=!state.canEditGroups;}
}
function clearBotcakeStatus(){bcVersion++;bcLedgerPage=0;$('bcSyncStatus').replaceChildren();$('bcLedgerRows').replaceChildren();$('bcLedgerCount').textContent='';$('bcNext').disabled=$('bcPrev').disabled=true;$('bcNext').dataset.enabled=$('bcPrev').dataset.enabled='false';for(const id of ['bcSync','bcStatus','bcLedgerLoad'])$(id).disabled=false;feedback('bcSyncFeedback');}
function renderBotcakeStatus(s){
  const root=$('bcSyncStatus');root.replaceChildren();const label=!s.startedAt?'Đang khởi tạo dữ liệu nền':s.job?.state==='failed'?'Cần thử lại đồng bộ':s.job?.state!=='complete'?'Đang đồng bộ':'Đã hoàn tất lượt đồng bộ';
  root.append(el('p',label,'pill '+(s.job?.state==='complete'?'good':'warn')),el('p','Bắt đầu theo dõi: '+bcTime(s.startedAt),'hint'),el('p','Lần hoàn tất gần nhất: '+bcTime(s.syncedAt),'hint'));
  const stats=el('div',undefined,'bcStats');for(const [name,n] of [['SĐT nền',s.baselineCount],['SĐT mới đã ghi nhận',s.newCount],['Thiếu ngày hợp lệ',s.pendingCount],['Khách đã quét',s.customerCount]]){const item=el('div');item.append(el('b',String(n??'—')),el('small',name));stats.append(item);}root.append(stats);
  if(s.job&&s.job.state!=='complete')root.append(el('p','Đã lưu tiến độ · bước '+s.job.stage+'. Bấm Đồng bộ tiếp hoặc đợi GitHub Actions.','hint'));if(s.lastError)root.append(el('p',s.lastError,'feedback error'));
}
async function botcakeOperation(action){
  const version=++bcVersion,pageId=$('bcPage').value;if(!pageId){feedback('bcSyncFeedback','Chọn Page đã kết nối.',true);return;}
  const buttons=['bcSync','bcStatus','bcLedgerLoad','bcPrev','bcNext'];for(const id of buttons)$(id).disabled=true;feedback('bcSyncFeedback',action==='sync'?'Đang đồng bộ và giữ tiến độ…':'Đang đọc kho SĐT…');
  try{const from=$('bcFrom').value,to=$('bcTo').value;if(action==='ledger'&&(!from||!to||from>to))throw Error('Kiểm tra khoảng ngày bắt đầu và kết thúc.');const r=await api('botcake',{action,pageId,from,to,page:bcLedgerPage},60000);if(version!==bcVersion)return;renderBotcakeStatus(r.status);
    if(r.ledger){const l=r.ledger;$('bcLedgerRows').replaceChildren(salesTable(['SĐT đã che','Page / PSID','Ngày ghi nhận','Ad tại ghi nhận','Tương tác gần nhất','Phân loại'],l.rows.map(row=>[row.phone,row.pageId+' / '+(row.psid||'Chưa có'),row.recordedDay||'—',row.adId||'Chưa xác định',bcTime(row.lastInteractiveAt),row.baseline?'Dữ liệu nền':row.recordedDay?'SĐT mới':'Thiếu ngày'])));$('bcLedgerCount').textContent=l.total+' bản ghi · trang '+(bcLedgerPage+1);$('bcPrev').dataset.enabled=String(bcLedgerPage>0);$('bcNext').dataset.enabled=String((bcLedgerPage+1)*50<l.total&&bcLedgerPage<100);}
    feedback('bcSyncFeedback',action==='sync'?'Đã lưu tiến độ. Kiểm tra trạng thái và lần hoàn tất trước khi dùng báo cáo.':'Đã cập nhật.');
  }catch(e){if(version===bcVersion)feedback('bcSyncFeedback',e.message,true);}finally{if(version===bcVersion){for(const id of ['bcSync','bcStatus','bcLedgerLoad'])$(id).disabled=false;for(const id of ['bcPrev','bcNext'])$(id).disabled=$(id).dataset.enabled!=='true';}}
}
function fillBotcakeTemplate(definition){
  $('tplBotcakeEnabled').checked=!!definition?.botcake;renderBotcakePages(definition?.botcake?.pageIds||[]);
}
function renderBotcakePages(selected){
  $('tplBotcakePages').replaceChildren(...(state.botcakeConnections||[]).map(c=>{const label=el('label',undefined,'checkLabel'),input=el('input');input.type='checkbox';input.value=c.pageId;input.checked=selected.includes(c.pageId);input.onchange=()=>{builderMarkDirty();renderBuilderChoices();};label.append(input,el('span',c.name+' · '+c.pageId));return label;}));
  for(const id of selected)if(!state.botcakeConnections?.some(c=>c.pageId===id))$('tplBotcakePages').append(el('p','Page '+id+' chưa có kết nối. Kiểm tra Nguồn dữ liệu.','feedback error'));
}
function botcakeTemplateDraft(){
  if($('tplSource').value==='sheets'||!$('tplBotcakeEnabled').checked)return {};
  const pageIds=[...$('tplBotcakePages').querySelectorAll('input')].filter(input=>input.checked).map(input=>input.value);if(!pageIds.length)throw Error('Botcake: chọn ít nhất một Page.');return {botcake:{pageIds}};
}
function botcakeTemplateFields(){
  $('tplBotcakeFields').hidden=$('tplSource').value==='sheets';$('tplBotcakeSelection').hidden=!$('tplBotcakeEnabled').checked;
}
function renderBotcakeReport(report){
  let root=$('botcakeReport');if(!root)return;root.replaceChildren();root.hidden=!report?.botcake;if(!report?.botcake)return;const b=report.botcake;
  root.append(el('h2','SĐT Botcake'),el('p',b.message,'hint'),el('p',b.pageNames.join(', ')+' · Đồng bộ: '+bcTime(b.syncedAt),'hint'));
  root.append(salesTable(['Campaign','SĐT mới khớp','Chi phí/SĐT'],b.campaigns.map(c=>[c.name,salesNumber(c.phones),salesNumber(c.cpa,report.currency)])));const link=el('a','Xem sổ SĐT tại Nguồn dữ liệu');link.href='#sources';root.append(link);
}
document.getElementById('tplBotcakeEnabled').onchange=()=>{botcakeTemplateFields();builderMarkDirty();renderBuilderChoices();};
