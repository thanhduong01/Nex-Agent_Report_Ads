"use strict";
let salesResult, salesTab="overview", salesVersion=0, posEditingId, posBaseRevision, posFormDirty=false, posStatusVersion=0;
const salesToday=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
function salesNumber(value,currency) {
  return value===null||value===undefined?"—":new Intl.NumberFormat("vi-VN",{maximumFractionDigits:currency?0:2}).format(value)+(currency?" "+currency:"");
}
function salesBox(title,description) {
  const box=el("section",undefined,"panel builderPanel");box.append(el("h2",title));if(description)box.append(el("p",description,"hint"));return box;
}
function setupSales(data) {
  if(salesResult){salesVersion++;salesResult=undefined;$("salesSendPreview").disabled=true;$("salesContent").replaceChildren();feedback("salesFeedback","Cấu hình đã cập nhật. Bấm Xem báo cáo để lấy lại số liệu.");}
  if(!$('pancakeForm'))buildPancakeSources();
  const connections=data.pancakeConnections||[];
  const old=$('posSaved').value;builderSelect($('posSaved'),connections,old,"+ Tạo kết nối mới");
  if(!posFormDirty)fillPosConnection();
  const active=$('posSyncConnection').value;builderSelect($('posSyncConnection'),connections,active,"Chọn kết nối");posSyncShops();
  $('posDatabaseNote').textContent=data.databaseConfigured?"Đã cấu hình DATABASE_URL. Bấm Kiểm tra để xác nhận kết nối và tạo bảng.":"Chưa có DATABASE_URL. Kết nối PostgreSQL/Supabase trên Vercel Production trước khi đồng bộ đơn.";
  const groups=data.groups.filter(g=>g.report?.source==="pancake"),selected=$('salesGroup').value;
  builderSelect($('salesGroup'),groups,selected,"Chọn mẫu Meta + Pancake");
  if(!selected&&groups.length)$('salesGroup').value=groups[0].id;
  $('salesEmpty').hidden=groups.length>0;$('salesLoad').disabled=!groups.length;
  if(!$('salesFrom').value){$('salesFrom').value=salesToday();$('salesTo').value=salesToday();}
}
function buildPancakeSources() {
  // Static authored markup only. All API values below are rendered using textContent / Option.
  $('pancakeSources').innerHTML=`<div class="builderGrid posSources"><section class="panel builderPanel"><div class="sectionLine"><h2>Kết nối Pancake POS</h2><span class="pill">Chỉ đọc đơn hàng</span></div><p class="hint">Dùng khóa API của shop trong Pancake → Cấu hình → Kết nối bên thứ ba → API. Ứng dụng chỉ gọi GET; quyền của khóa do Pancake cấp.</p><form id="pancakeForm"><fieldset id="posConnectionFields"><label for="posSaved">Kết nối đã lưu</label><select id="posSaved"></select><label for="posName">Tên kết nối</label><input id="posName" maxlength="80" required><label for="posShopIds">ID shop · phân cách bằng dấu phẩy</label><input id="posShopIds" maxlength="620" required placeholder="12345, 67890" inputmode="numeric"><label for="posKey">Khóa API Pancake</label><input id="posKey" type="password" maxlength="4096" autocomplete="off" spellcheck="false"><p class="hint">Khóa được giữ riêng trên máy chủ. Để trống khi dùng lại khóa đã lưu.</p><div class="builderActions"><button class="primary" id="posSave">Kiểm tra &amp; lưu kết nối</button><button class="secondary" type="button" id="posRemove" hidden>Gỡ kết nối</button></div></fieldset></form><p id="posFeedback" class="feedback" role="status"></p></section><section class="panel builderPanel"><h2>Kho dữ liệu &amp; đồng bộ</h2><p class="hint" id="posDatabaseNote"></p><button id="posDatabaseCheck" class="secondary" type="button">Kiểm tra database &amp; tạo bảng</button><p id="posDatabaseFeedback" class="feedback" role="status"></p><div class="requestDivider"></div><label for="posSyncConnection">Kết nối</label><select id="posSyncConnection"></select><label for="posSyncShop">Shop đồng bộ</label><select id="posSyncShop"></select><p class="hint">Lần đầu nhập 8 ngày gần nhất. Mỗi tác vụ lưu tiến độ từng trang; GitHub Actions tiếp tục kiểm tra mỗi 5 phút. Không lưu thông tin cá nhân khách hàng.</p><div class="builderActions"><button id="posSync" type="button" class="primary">Đồng bộ tiếp</button><button id="posStatus" type="button" class="secondary">Xem trạng thái</button><button id="posRetryEvents" type="button" class="secondary">Thử lại đơn chờ đối chiếu</button><button id="posWebhook" type="button" class="secondary">Hướng dẫn webhook</button></div><div id="posSyncStatus" class="posSyncStatus" aria-live="polite"></div><p id="posSyncFeedback" class="feedback" role="status"></p><div id="posWebhookDetails" hidden><p class="hint">Tại Pancake → Kết nối bên thứ ba → Webhook/API, chọn loại orders và thêm header bên dưới. Giữ nguyên webhook đang phục vụ ứng dụng khác; có thể dùng đồng bộ định kỳ nếu không thêm được.</p><label>Webhook URL<input id="posWebhookUrl" readonly></label><label>X-Nex-Webhook-Secret<input id="posWebhookSecret" readonly type="password" autocomplete="off"></label><label class="checkLabel"><input id="posRevealSecret" type="checkbox">Hiện secret để sao chép</label><p class="hint">Webhook được ghi vào hàng đợi riêng trước khi xác nhận, rồi lấy lại chi tiết đơn trong lần đồng bộ kế tiếp.</p></div></section></div>`;
  $('pancakeForm').oninput=()=>{posFormDirty=true;};
  $('posSaved').onchange=()=>{if(posFormDirty&&!confirm("Bỏ thay đổi kết nối chưa lưu?")){$('posSaved').value=posEditingId||"";return;}posFormDirty=false;fillPosConnection();};
  $('pancakeForm').onsubmit=savePosConnection;
  $('posDatabaseCheck').onclick=async()=>{const b=$('posDatabaseCheck');b.disabled=true;feedback('posDatabaseFeedback','Đang kiểm tra kết nối…');try{const r=await api('pancake',{action:'database'},30000);feedback('posDatabaseFeedback',r.database.message,!r.database.connected);}catch(e){feedback('posDatabaseFeedback',e.message,true);}finally{b.disabled=false;}};
  $('posSyncConnection').onchange=()=>{posSyncShops();clearPosStatus();};$('posSyncShop').onchange=clearPosStatus;
  $('posSync').onclick=()=>posOperation('sync');$('posStatus').onclick=()=>posOperation('status');$('posWebhook').onclick=()=>posOperation('webhook');$('posRetryEvents').onclick=()=>posOperation('retry-events');
  $('posRevealSecret').onchange=()=>{$('posWebhookSecret').type=$('posRevealSecret').checked?'text':'password';};
  $('posRemove').onclick=async()=>{if(!posEditingId||!confirm('Gỡ kết nối này? Đổi nguồn các mẫu đang sử dụng trước.'))return;
    $('posRemove').disabled=true;try{await api('pancake',{action:'save',revision:posBaseRevision,id:posEditingId,name:$('posName').value,shopIds:$('posShopIds').value.split(',').map(s=>s.trim()),remove:true});posFormDirty=false;posEditingId=undefined;await refreshSalesState();feedback('posFeedback','Đã gỡ kết nối.');}catch(e){feedback('posFeedback',e.message,true);}finally{$('posRemove').disabled=false;}};
  $('salesFilters').onsubmit=event=>{event.preventDefault();loadSales();};
  $('salesFilters').oninput=()=>{salesVersion++;salesResult=undefined;$('salesSendPreview').disabled=true;$('salesContent').replaceChildren();feedback('salesFeedback','Bộ lọc đã thay đổi. Bấm Xem báo cáo để lấy số liệu.');};
  $('salesSendPreview').onclick=()=>{if(salesResult){current=salesResult;$('preview').onclick();}};
  document.querySelectorAll('[data-sales-tab]').forEach(b=>{b.onclick=()=>{salesTab=b.dataset.salesTab;renderSales();};});
}
async function refreshSalesState(){const data=await api('state');updateState(data);}
function fillPosConnection(){
  const c=(state?.pancakeConnections||[]).find(c=>c.id===$('posSaved').value);posEditingId=c?.id;posBaseRevision=c?.revision;
  $('posName').value=c?.name||'';$('posShopIds').value=c?.shops.map(s=>s.id).join(', ')||'';$('posKey').value='';$('posKey').required=!c;$('posRemove').hidden=!c;
}
function posSyncShops(){const c=(state?.pancakeConnections||[]).find(c=>c.id===$('posSyncConnection').value);builderSelect($('posSyncShop'),c?.shops||[],$('posSyncShop').value,"Chọn shop");}
function clearPosStatus(){posStatusVersion++;$('posSyncStatus').replaceChildren();feedback('posSyncFeedback');$('posWebhookDetails').hidden=true;$('posWebhookSecret').value='';}
async function savePosConnection(event){
  event.preventDefault();const button=$('posSave');button.disabled=true;$('posConnectionFields').disabled=true;feedback('posFeedback','Đang xác nhận quyền truy cập shop…');
  try{const shopIds=$('posShopIds').value.split(',').map(s=>s.trim()).filter(Boolean);if(!shopIds.length||shopIds.some(id=>!/^\d{1,30}$/.test(id)))throw Error('Nhập ID shop bằng dãy số, phân cách bằng dấu phẩy.');
    const id=posEditingId||'pos-'+crypto.randomUUID().slice(0,12);
    await api('pancake',{action:'save',revision:posBaseRevision,id,name:$('posName').value.trim(),shopIds,key:$('posKey').value.trim()},60000);
    $('posKey').value='';posFormDirty=false;posEditingId=id;await refreshSalesState();$('posSaved').value=id;fillPosConnection();$('posSyncConnection').value=id;posSyncShops();
    feedback('posFeedback','Đã xác nhận và lưu kết nối. Chọn shop ở khung đồng bộ để nhập đơn.');
  }catch(e){feedback('posFeedback',e.message,true);}finally{button.disabled=false;$('posConnectionFields').disabled=false;}
}
async function posOperation(action){
  const version=++posStatusVersion,connectionId=$('posSyncConnection').value,shopId=$('posSyncShop').value;
  if(!connectionId||!shopId){feedback('posSyncFeedback','Chọn kết nối và shop trước.',true);return;}
  for(const id of ['posSync','posStatus','posWebhook','posRetryEvents'])$(id).disabled=true;
  feedback('posSyncFeedback',action==='sync'?'Đang đồng bộ đơn hàng và lưu tiến độ…':'Đang đọc cấu hình…');
  try{const r=await api('pancake',{action,connectionId,shopId},60000);if(version!==posStatusVersion)return;
    if(action==='webhook'){$('posWebhookDetails').hidden=false;$('posWebhookUrl').value=r.url;$('posWebhookSecret').value=r.secret;$('posRevealSecret').checked=false;$('posWebhookSecret').type='password';}
    else renderPosStatus(r.status);
    feedback('posSyncFeedback',action==='sync'?'Đã lưu tiến độ đồng bộ. Xem trạng thái để biết còn trang đang chờ.':'Đã cập nhật.');
  }catch(e){if(version===posStatusVersion)feedback('posSyncFeedback',e.message,true);}finally{for(const id of ['posSync','posStatus','posWebhook','posRetryEvents'])$(id).disabled=false;}
}
function renderPosStatus(status){
  const root=$('posSyncStatus');root.replaceChildren();const time=v=>v?new Date(v).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa có';
  root.append(el('p','Đơn đã nhập: '+(status.orderCount??'Chưa xác định')),el('p','Đơn đang chờ đối chiếu: '+(status.pendingEvents||0)),el('p','Đồng bộ gần nhất: '+time(status.syncedAt)),el('p','Dữ liệu từ: '+time(status.importFrom)),el('p','Đủ đến: '+time(status.completeThrough)));
  const labels={done:'Hoàn tất',running:'Đang chạy',queued:'Đang chờ',failed:'Cần chạy lại'};
  for(const j of status.jobs)root.append(el('p',(labels[j.state]||j.state)+' · trang '+j.page+' · '+(j.mode==='initial'?'nhập dữ liệu':'cập nhật')+(j.error?' · '+j.error:''),'hint'));
  if(status.error)root.append(el('p',status.error,'feedback error'));
}
async function loadSales(){
  const version=++salesVersion;$('salesLoad').disabled=true;salesResult=undefined;$('salesSendPreview').disabled=true;$('salesContent').replaceChildren();feedback('salesFeedback','Đang đọc chi phí và đơn đã đồng bộ…');
  try{if(!$('salesGroup').value)throw Error('Chọn mẫu Meta + Pancake.');const from=$('salesFrom').value,to=$('salesTo').value;
    if(!from||!to||from>to)throw Error('Kiểm tra khoảng ngày bắt đầu và kết thúc.');
    const result=await api('report?group='+encodeURIComponent($('salesGroup').value)+'&date='+encodeURIComponent(to)+'&from='+encodeURIComponent(from));
    if(version!==salesVersion)return;if(!result.report.sales)throw Error('Mẫu này chưa dùng nguồn Pancake.');salesResult=result;$('salesSendPreview').disabled=false;renderSales();feedback('salesFeedback',result.report.sales.complete?'Đã tải báo cáo.':'Chưa đủ dữ liệu. Kiểm tra tiến độ tại Nguồn dữ liệu.',!result.report.sales.complete);
  }catch(e){if(version===salesVersion)feedback('salesFeedback',e.message,true);}finally{$('salesLoad').disabled=!$('salesGroup').value;}
}
function salesCards(items){const grid=el('div',undefined,'salesMetrics');for(const [name,value,note] of items){const c=el('article',undefined,'panel salesMetric');c.append(el('h3',name),el('strong',value),el('small',note,'hint'));grid.append(c);}return grid;}
function salesTable(headers,rows){
  const box=el('div',undefined,'salesTableWrap'),table=el('table',undefined,'salesTable'),head=el('thead'),tr=el('tr');
  for(const h of headers){const cell=el('th',h);cell.scope='col';tr.append(cell);}head.append(tr);const body=el('tbody');
  for(const row of rows){const r=el('tr');row.forEach((v,i)=>{const c=el(i===0?'th':'td',String(v));if(i===0)c.scope='row';c.dataset.label=headers[i];r.append(c);});body.append(r);}
  table.append(head,body);box.append(table);if(!rows.length)box.append(el('p','Chưa có bản ghi đủ điều kiện trong khoảng ngày này.','hint'));return box;
}
function renderSales(){
  document.querySelectorAll('[data-sales-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.salesTab===salesTab)));
  const root=$('salesContent');root.replaceChildren();if(!salesResult)return;
  const report=salesResult.report,s=report.sales,t=s.totals,currency=report.currency;
  const quality=salesBox('Phạm vi & chất lượng dữ liệu',`Theo ngày tạo đơn · ${s.basis==='confirmed'?'Đã xác nhận':'Đã giao'} · ${report.range.from} → ${report.range.to} · ${currency} · Asia/Ho_Chi_Minh`);
  quality.append(el('p','Meta: các campaign trong mẫu. Doanh thu shop gồm cả đơn chưa nối campaign; CPA/ROAS chỉ dùng đơn nối chính xác.','hint'));
  quality.append(el('p','Đồng bộ đến: '+(s.quality.completeThrough?new Date(s.quality.completeThrough).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa hoàn tất'),'hint'));
  for(const warning of s.quality.warnings)quality.append(el('p',warning,'salesWarning'));root.append(quality);
  if(salesTab==='overview'){
    root.append(salesCards([['Chi phí Meta',salesNumber(t.spend,currency),'Trong phạm vi campaign đã chọn'],['Đơn Pancake',salesNumber(t.orders),'Toàn shop, trạng thái đã chọn'],['Sản phẩm giữ lại',salesNumber(t.units),'Trừ hoàn; theo quy tắc quà tặng của mẫu'],['Doanh thu hàng hóa',salesNumber(t.revenue,currency),'Sau chiết khấu, không gồm vận chuyển'],['CPA đơn nối',salesNumber(t.cpa,currency),'Không tính khi dữ liệu chưa đủ chất lượng'],['ROAS đơn nối',salesNumber(t.roas),'Doanh thu đã nối / chi phí Meta']]));
    const box=salesBox('Sản phẩm bán chạy','Xếp hạng theo số lượng giữ lại. Chưa có dữ liệu so sánh cùng thời điểm.');box.append(salesTable(['Sản phẩm','Số lượng','Đơn có sản phẩm','Doanh thu'],s.products.slice(0,5).map(p=>[p.name,salesNumber(p.units),salesNumber(p.orders),salesNumber(p.revenue,currency)])));root.append(box);
  }else if(salesTab==='campaigns'){
    const box=salesBox('Campaign & đơn hàng thực tế','Chỉ gán đơn bằng ID ad thuộc campaign đã chọn. Chi phí không được chia tùy ý cho sản phẩm.');box.append(salesTable(['Campaign','Chi phí','Đơn nối','Doanh thu nối','CPA','ROAS'],s.campaigns.map(c=>[c.name,salesNumber(c.cost,currency),salesNumber(c.orders),salesNumber(c.revenue,currency),salesNumber(c.cpa,currency),salesNumber(c.roas)])));root.append(box);
  }else if(salesTab==='products'){
    const box=salesBox('Sản phẩm bán trong kỳ','Một đơn có thể chứa nhiều sản phẩm. Số đơn trong các dòng sản phẩm không cộng thành tổng đơn shop.');box.append(salesTable(['Sản phẩm / SKU','Số lượng','Đơn có sản phẩm','Doanh thu','Campaign đã nối'],s.products.map(p=>[p.name+(p.sku?' · '+p.sku:''),salesNumber(p.units),salesNumber(p.orders),salesNumber(p.revenue,currency),p.campaignIds.length?String(p.campaignIds.length):'Chưa nối'])));root.append(box);
  }else if(salesTab==='matching'){
    const a=s.attribution;root.append(salesCards([['Đơn đã nối',s.complete?salesNumber(a.matchedOrders):'—','ID ad trùng chính xác'],['Đơn chưa gán',s.complete?salesNumber(a.unmatchedOrders):'—','Không suy đoán bằng tên hay hội thoại'],['Độ phủ',s.complete&&a.coverage!==null?salesNumber(a.coverage*100)+'%':'—','Đơn đã nối / đơn shop đủ điều kiện']]));
    const statuses=salesBox('Trạng thái đơn trong kỳ','Nhãn do bạn cấu hình; mã trạng thái gốc được giữ nguyên.');statuses.append(salesTable(['Mã','Nhãn','Số đơn'],(s.statusCounts||[]).filter(row=>row.count>0).map(row=>[row.code,row.label,row.count])));root.append(statuses);
    const box=salesBox('Lý do chưa gán & bản ghi loại trừ');box.append(salesTable(['Lý do','Số đơn'],[['Thiếu ID ad',a.reasons.missing_id],['ID / UTM mâu thuẫn',a.reasons.ambiguous],['Ngoài phạm vi hoặc ID chưa tìm thấy',a.reasons.out_of_scope],['Khác tiền tệ',s.excluded.currency],['Trạng thái không được tính / đã xóa',s.excluded.status],['Đơn bỏ dở',s.excluded.abandoned]]));root.append(box);
  }else{
    const box=salesBox('Nhận định có căn cứ','Tín hiệu dựa trên số liệu, không tự điều chỉnh ngân sách. Chưa kết luận tăng trưởng khi thiếu so sánh cùng thời điểm.');
    if(!s.signals.length)box.append(el('p','Chưa đủ dữ liệu để đưa ra nhận định.','hint'));
    for(const signal of s.signals){const card=el('article',undefined,'salesSignal');card.append(el('h3',signal.title),el('p',signal.detail));box.append(card);}root.append(box);
  }
}
function fillSalesTemplate(definition){
  builderSelect($('tplPosConnection'),state.pancakeConnections||[],definition?.pancakeConnectionId,'Chọn kết nối Pancake');fillSalesTemplateShops(definition?.shopId);
  const p=definition?.salesPolicy||{};$('tplPosBasis').value=p.basis||'confirmed';$('tplPosDiscount').value=p.discountMode||'total';$('tplPosCpa').value=p.targetCpa||100000;$('tplPosMinimum').value=p.minimumOrders||10;$('tplPosGifts').checked=!!p.includeGifts;$('tplPosUtm').checked=!!p.allowUtmAdId;
}
function fillSalesTemplateShops(value){const c=(state.pancakeConnections||[]).find(c=>c.id===$('tplPosConnection').value);builderSelect($('tplPosShop'),c?.shops||[],value,'Chọn shop');}
function salesTemplateDraft(){
  if(!$('tplPosConnection').value||!$('tplPosShop').value)throw Error('Chọn kết nối và shop Pancake.');
  const old=state.groups.find(g=>g.id===builderGroupId)?.report?.salesPolicy||{};
  return {pancakeConnectionId:$('tplPosConnection').value,shopId:$('tplPosShop').value,salesPolicy:{...old,basis:$('tplPosBasis').value,discountMode:$('tplPosDiscount').value,includeGifts:$('tplPosGifts').checked,allowUtmAdId:$('tplPosUtm').checked,targetCpa:Number($('tplPosCpa').value),minimumOrders:Number($('tplPosMinimum').value)}};
}
