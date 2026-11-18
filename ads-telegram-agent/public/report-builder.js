"use strict";
let builderGroupId, builderDirty=false, metricDirty=false, metaEditingId, metricEditingId;
let builderBase, builderSaving=false, builderCreating=false;
let builderCampaigns=[], builderCampaignIds=[], builderMetricOrder=[], builderCampaignVersion=0, builderPreviewVersion=0, formulaPreviewVersion=0;
function builderParameters(text) {
  const result=Object.create(null);
  for(const line of text.split(/\n/).map(value=>value.trim()).filter(Boolean)) {
    const match=/^([a-z][a-z0-9_]{0,47})\s*=\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(line);
    if(!match||!Number.isFinite(Number(match[2]))||Math.abs(Number(match[2]))>1e12)throw Error("Biến cố định: mỗi dòng dùng tên_biến = số, tối đa ±1.000 tỷ.");
    if(Object.hasOwn(result,match[1]))throw Error("Tên biến cố định bị trùng: "+match[1]);
    result[match[1]]=Number(match[2]);
  }
  if(Object.keys(result).length>20)throw Error("Tối đa 20 biến cố định.");
  return result;
}
const builderParameterText=parameters=>Object.entries(parameters||{}).map(([key,value])=>key+" = "+value).join("\n");
function builderValueMap(text,status=false){
  const result=Object.create(null);
  for(const line of text.split(/\n/).map(s=>s.trim()).filter(Boolean)){
    const match=/^(-?\d+(?:\.\d+)?)\s*=\s*(.+)$/.exec(line);
    if(!match||(status&&!/^\d{1,3}$/.test(match[1]))||match[2].length>(status?80:100))throw Error("Quy đổi mã: mỗi dòng dùng mã = nhãn hiển thị hợp lệ.");
    if(Object.hasOwn(result,match[1]))throw Error("Mã quy đổi bị trùng: "+match[1]);result[match[1]]=match[2];
  }
  if(Object.keys(result).length>(status?30:50))throw Error("Quá nhiều mã quy đổi.");return result;
}
const builderMapText=map=>Object.entries(map||{}).map(([code,label])=>code+" = "+label).join("\n");
function pickerOptions(select,items,query="",placeholder="Chọn một trường"){
  const current=select.value,search=query.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const options=items.filter(item=>(item.name+" "+item.id+" "+item.group).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().includes(search));
  select.replaceChildren(new Option(placeholder,""));
  for(const name of [...new Set(options.map(item=>item.group))]){
    const group=el('optgroup');group.label=name;
    for(const item of options.filter(item=>item.group===name))group.append(new Option(item.name+" · "+item.id,item.id));select.append(group);
  }
  select.value=options.some(item=>item.id===current)?current:"";
}
function metricProvider(metric){return state.metrics?.some(m=>m.id===metric.id)?'Chỉ số tự tính':metric.provider==='botcake'?'Botcake':metric.provider==='pancake'||/^pos_/.test(metric.id)?'Pancake POS':metric.provider==='meta'?'Meta Ads Insights':'Chỉ số chung / Meta / Sheets';}
function renderFormulaPicker(){
  const variables=[...Object.entries(state.baseVariables||{}).map(([id,name])=>({id,name,group:id.startsWith('BOTCAKE_')?'Botcake':(id.startsWith('pos_')||id.startsWith('POS_'))?'Pancake POS':(id.startsWith('meta_')||id.startsWith('META_'))?'Meta Ads Insights':'Chỉ số chung / Meta / Sheets'})),
    ...Object.keys(state.parameters||{}).map(id=>({id,name:id,group:'Biến cố định'})),...(state.metrics||[]).filter(m=>m.id!==metricEditingId).map(m=>({id:m.id,name:m.name,group:'Chỉ số tự tính'}))];
  pickerOptions($("formulaVariableSelect"),variables,$("formulaVariableSearch").value);
}
function builderMarkDirty() {
  builderDirty=true;builderPreviewVersion++;
  $("tplPreview").disabled=false;
  $("templateSaveState").textContent="Chưa lưu";$("templateSaveState").className="pill warn";
  feedback("templatePreviewFeedback","Cấu hình đã đổi. Chạy thử lại để kiểm tra bản tin mới.");
}
function builderSelect(select,options,value,empty) {
  select.replaceChildren(...(empty?[new Option(empty,"")]:[]),...options.map(option=>new Option(option.name,option.id)));
  select.value=options.some(option=>option.id===value)?value:(empty?"":options[0]?.id||"");
}
function setupBuilder(data) {
  const selectedMeta=$("metaSaved").value||metaEditingId||"";
  builderSelect($("metaSaved"),data.metaConnections||[],selectedMeta,"+ Tạo kết nối mới");
  if(!metaEditingId||!data.metaConnections.some(item=>item.id===metaEditingId))fillMetaConnection();
  $("metaAccounts").replaceChildren();
  let count=0;
  for(const connection of data.metaConnections||[]) {
    const section=el("div",undefined,"builderSource");
    section.append(el("h3",connection.name),el("small","Kiểm tra lúc "+new Date(connection.checkedAt).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"}),"hint"));
    for(const account of connection.accounts) {
      count++;const row=el("div",undefined,"builderAccount");
      row.append(el("b",account.name),el("small",account.id+" · "+account.currency+" · "+account.timezone_name));
      section.append(row);
    }
    $("metaAccounts").append(section);
  }
  $("metaAccountCount").textContent=count;
  if(!count)$("metaAccounts").append(el("p","Chưa có kết nối Meta. Lưu token hợp lệ để đọc danh sách tài khoản.","hint"));
  if(!builderCreating)builderGroupId=data.groups.some(group=>group.id===builderGroupId)?builderGroupId:data.groups[0]?.id;
  builderSelect($("tplGroup"),[...data.groups,...(builderCreating?[{id:builderGroupId,name:"Mẫu mới · chưa lưu"}]:[])],builderGroupId);
  $("templateFields").disabled=!data.canEditGroups||!builderGroupId;
  if(!builderDirty)fillBuilderGroup();
  else {
    const selectedConnection=$("tplConnection").value,selectedAccount=$("tplAccount").value;
    builderSelect($("tplConnection"),data.metaConnections||[],selectedConnection,"Chọn kết nối");
    builderMetricOrder=builderMetricOrder.filter(id=>(data.metricDefinitions||[]).some(metric=>metric.id===id));
    if(typeof renderBotcakePages==="function")renderBotcakePages([...$("tplBotcakePages").querySelectorAll("input")].filter(input=>input.checked).map(n=>n.value));
    builderAccounts(selectedAccount);renderBuilderChoices();
    if(typeof fillSalesTemplateShops==="function"){const selectedPos=$("tplPosConnection").value,shop=$("tplPosShop").value;builderSelect($("tplPosConnection"),data.pancakeConnections||[],selectedPos,"Chọn kết nối Pancake");fillSalesTemplateShops(shop);}
  }
  const selectedMetric=metricEditingId||"";
  builderSelect($("metricSaved"),data.metrics||[],selectedMetric,"+ Chỉ số mới");
  if(!metricDirty)fillMetric();
  for(const id of ["metaSave","metricSave","newMetric"])$(id).disabled=!data.canEditGroups;
}
function fillMetaConnection() {
  metaEditingId=$("metaSaved").value||undefined;
  const item=state?.metaConnections?.find(connection=>connection.id===metaEditingId);
  $("metaName").value=item?.name||"";$("metaToken").value="";$("metaToken").required=!item;
  $("metaRemove").hidden=!item;feedback("metaFeedback");
}
function builderAccounts(value) {
  const connection=state.metaConnections.find(item=>item.id===$("tplConnection").value);
  builderSelect($("tplAccount"),connection?.accounts||[],value,"Chọn tài khoản");
  builderAccountInfo();
}
function builderAccountInfo() {
  const connection=state.metaConnections.find(item=>item.id===$("tplConnection").value);
  const account=connection?.accounts.find(item=>item.id===$("tplAccount").value);
  $("tplAccountInfo").textContent=account?account.currency+" · Ngày dữ liệu theo múi giờ "+account.timezone_name:"Chọn kết nối và tài khoản trước khi đọc campaign.";
}
function fillBuilderGroup() {
  const group=state.groups.find(item=>item.id===builderGroupId),definition=group?.report;
  builderBase=builderTemplateVersion(group);
  if(typeof fillBotcakeTemplate==="function")fillBotcakeTemplate(definition);
  if(typeof fillSalesTemplate==="function")fillSalesTemplate(definition);
  $("tplName").value=group?.name||"";
  $("tplSource").value=definition?.source||"sheets";
  builderSelect($("tplConnection"),state.metaConnections||[],definition?.connectionId,"Chọn kết nối");
  builderAccounts(definition?.accountId);
  builderCampaignIds=[...(definition?.campaignIds||[])];builderCampaigns=[];builderCampaignVersion++;
  $("tplCampaignSearch").value="";
  const common=["onsite_conversion.messaging_conversation_started_7d","onsite_conversion.messaging_first_reply"];
  const action=definition?.messageAction||common[0];
  $("tplMessageAction").value=common.includes(action)?action:"custom";$("tplMessageCustom").value=common.includes(action)?"":action;
  const products=[...new Set(Object.values(group?.sources||{}).flatMap(source=>source.mappings?.map(mapping=>mapping.name)||["Hàn Quốc","Thượng Hải","Đài Loan","Khách Sạn"]))];
  builderSelect($("tplPhoneProduct"),products.map(name=>({id:name,name})),definition?.phoneSheetName,"Chọn sản phẩm Sheets");
  $("tplPeriod").value=definition?.period||"today";$("tplComparison").value=definition?.comparison||"previous";$("tplDetail").value=definition?.detail||"summary";
  $("tplConstants").value=builderParameterText(definition?.constants);
  $("tplBody").value=definition?.body||"";
  $("tplStatusLabels").value=builderMapText(definition?.statusLabels);
  builderMetricOrder=[...(definition?.metrics||["cost","messages","phones","cost_per_message"])];
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  $("tplAnchor").value=today;$("tplFrom").value=today;$("tplTo").value=today;
  $("templateSaveState").textContent=builderCreating?"Mẫu mới · chưa lưu":definition?"Đã lưu":"Mẫu Sheets hiện tại";$("templateSaveState").className="pill";
  $("tplReset").hidden=!definition;
  $("templatePreviewText").textContent="Chọn nguồn, chỉ số và chạy thử để xem báo cáo.";
  $("templatePreviewMetrics").replaceChildren();feedback("templateFeedback");feedback("templatePreviewFeedback");
  builderPreviewVersion++;$("tplPreview").disabled=false;renderBuilderChoices();builderSourceFields();renderBuilderCampaigns();
}
function builderSourceFields() {
  if(typeof botcakeTemplateFields==="function")botcakeTemplateFields();
  const source=$("tplSource").value;
  $("tplStatusMapping").hidden=source!=="pancake";
  if($("tplPosFields")){ $("tplPosFields").hidden=source!=="pancake"; for(const id of ["tplPosConnection","tplPosShop","tplPosCpa","tplPosMinimum"]){$(id).required=source==="pancake";} for(const input of $("tplPosFields").querySelectorAll("input,select"))input.disabled=source!=="pancake"; }
  $("tplComparison").disabled=source==="pancake";if(source==="pancake")$("tplComparison").value="none";
  $("tplMetaFields").hidden=source==="sheets";$("tplPhoneFields").hidden=source!=="hybrid";
  $("tplConnection").required=source!=="sheets";$("tplAccount").required=source!=="sheets";$("tplPhoneProduct").required=source==="hybrid";
  $("tplMessageCustom").hidden=$("tplMessageAction").value!=="custom";
  $("tplMessageCustomLabel").hidden=$("tplMessageCustom").hidden;$("tplMessageCustom").required=source!=="sheets"&&!$("tplMessageCustom").hidden;
  for(const id of ["tplConnection","tplAccount","tplPhoneProduct","tplMessageCustom"]) {
    if($(id).hidden)$(id).required=false;
  }
}
function renderBuilderCampaigns() {
  const query=$("tplCampaignSearch").value.trim().toLocaleLowerCase("vi");
  const available=builderCampaigns.filter(item=>(item.name+" "+item.id).toLocaleLowerCase("vi").includes(query));
  $("tplCampaigns").replaceChildren(...available.map(item=>{
    const label=el("label",undefined,"checkLabel builderCampaign"),checkbox=el("input");checkbox.type="checkbox";
    checkbox.checked=builderCampaignIds.includes(item.id);
    checkbox.onchange=()=>{builderCampaignIds=checkbox.checked?[...new Set([...builderCampaignIds,item.id])]:builderCampaignIds.filter(id=>id!==item.id);$("tplCampaignCount").textContent=builderCampaignIds.length;builderMarkDirty();};
    const text=el("span");text.append(el("b",item.name),el("small",item.id+(item.effective_status?" · "+item.effective_status:"")));
    label.append(checkbox,text);return label;
  }));
  $("tplCampaignCount").textContent=builderCampaignIds.length;
  if(!available.length)$("tplCampaigns").append(el("p",builderCampaigns.length?"Không có campaign khớp từ khoá.":builderCampaignIds.length?"Đã lưu "+builderCampaignIds.length+" ID. Bấm Đọc danh sách campaign để xem tên và chỉnh phạm vi.":"Bấm Đọc danh sách campaign để chọn phạm vi.","hint"));
}
async function loadBuilderCampaigns() {
  const version=++builderCampaignVersion;
  $("tplLoadCampaigns").disabled=true;feedback("templateFeedback","Đang đọc danh sách campaign…");
  try {
    if(!$("tplConnection").value||!$("tplAccount").value)throw Error("Chọn kết nối và tài khoản Meta.");
    const response=await api("meta-campaigns",{connectionId:$("tplConnection").value,accountId:$("tplAccount").value});
    if(version!==builderCampaignVersion)return;
    builderCampaigns=response.campaigns;renderBuilderCampaigns();feedback("templateFeedback","Đã đọc "+builderCampaigns.length+" campaign. Chọn những campaign thuộc mẫu này.");
  }catch(error){if(version===builderCampaignVersion)feedback("templateFeedback",error.message,true);}
  finally{if(version===builderCampaignVersion)$("tplLoadCampaigns").disabled=false;}
}
function builderInsert(input,text) {
  const at=input.selectionStart??input.value.length,end=input.selectionEnd??at;
  input.value=input.value.slice(0,at)+text+input.value.slice(end);input.focus();input.setSelectionRange(at+text.length,at+text.length);
  input.dispatchEvent(new Event("input",{bubbles:true}));
}
function renderBuilderChoices() {
  let labels={};try{labels=builderValueMap($("tplStatusLabels").value,true);}catch{/* Keep typing; validation runs when saved. */}
  const definitions=(state.metricDefinitions||[]).map(metric=>{const code=/^API_POS_STATUS_(\d+)$/.exec(metric.id)?.[1];return code&&labels[code]?{...metric,name:"POS · Số đơn trạng thái "+code+" · "+labels[code]}:metric;});
  const order=[...builderMetricOrder];
  pickerOptions($("tplMetricSelect"),definitions.filter(m=>!builderMetricOrder.includes(m.id)&&(m.provider!=="botcake"||$("tplBotcakeEnabled")?.checked&&$("tplSource").value!=="sheets")).map(m=>({id:m.id,name:m.name,group:metricProvider(m)})),$("tplMetricSearch").value,"Chọn chỉ số cần thêm");
  $("tplMetricList").replaceChildren(...order.map(id=>definitions.find(metric=>metric.id===id)).filter(Boolean).map(metric=>{
    const row=el("div",undefined,"builderMetricChoice"),label=el("label",undefined,"checkLabel"),input=el("input");input.type="checkbox";input.checked=builderMetricOrder.includes(metric.id);
    const text=el("span");text.append(el("b",metric.name),el("small",metric.formula));
    input.onchange=()=>{builderMetricOrder=input.checked?[...builderMetricOrder,metric.id]:builderMetricOrder.filter(id=>id!==metric.id);builderMarkDirty();renderBuilderChoices();};
    label.append(input,text);row.append(label);
    if(input.checked) {
      const controls=el("div",undefined,"metricOrderControls"),index=builderMetricOrder.indexOf(metric.id);
      for(const [offset,title] of [[-1,"Lên"],[1,"Xuống"]]) {
        const button=el("button",offset<0?"↑":"↓","secondary");button.type="button";button.setAttribute("aria-label",title+" chỉ số "+metric.name);
        button.disabled=index+offset<0||index+offset>=builderMetricOrder.length;
        button.onclick=()=>{[builderMetricOrder[index],builderMetricOrder[index+offset]]=[builderMetricOrder[index+offset],builderMetricOrder[index]];builderMarkDirty();renderBuilderChoices();};controls.append(button);
      }row.append(controls);
    }
    return row;
  }));
  const variables=["ten_nhom","ky_bao_cao","chi_so","chi_tiet","so_sanh","nguon","thoi_diem_doc","mui_gio","san_pham_ban_chay","nhan_dinh","doi_soat","TRANG_THAI_DON_HANG"];
  const useBotcake=$("tplBotcakeEnabled")?.checked&&$("tplSource").value!=="sheets";
  const selectedMetrics=builderMetricOrder.map(id=>definitions.find(m=>m.id===id)).filter(m=>m&&m.scope!=="row");
  const bcText=useBotcake?Object.entries(state.botcakeTextVariables||{}).map(([id,name])=>({id,name,group:'Botcake · nội dung'})):[];
  const bcNumbers=useBotcake?Object.entries(state.botcakeAliases||{}).filter(([,id])=>builderMetricOrder.includes(id)).map(([id,target])=>({id,name:definitions.find(m=>m.id===target)?.name||id,group:'Botcake · chỉ số đã chọn'})):[];
  pickerOptions($("tplPlaceholderSelect"),[...variables.map(id=>({id,name:"{{"+id+"}}",group:"Nội dung báo cáo"})),...bcText,...bcNumbers,...selectedMetrics.map(m=>({id:m.id,name:m.name,group:metricProvider(m)}))],$("tplPlaceholderSearch").value);
}
function templateDraft() {
  const source=$("tplSource").value;
  if(!builderMetricOrder.length)throw Error("Chọn ít nhất một chỉ số.");
  if(source!=="sheets"&&!builderCampaignIds.length)throw Error("Chọn ít nhất một campaign cho mẫu.");
  if(builderCampaignIds.length>100)throw Error("Tối đa 100 campaign trong một mẫu.");
  return {source,...(typeof botcakeTemplateDraft==="function"?botcakeTemplateDraft():{}),...(source!=="sheets"?{connectionId:$("tplConnection").value,accountId:$("tplAccount").value,campaignIds:builderCampaignIds,
    messageAction:$("tplMessageAction").value==="custom"?$("tplMessageCustom").value.trim():$("tplMessageAction").value}:{}),
    ...(source==="hybrid"?{phoneSheetName:$("tplPhoneProduct").value}:{}),
    ...(source==="pancake"?salesTemplateDraft():{}),
    statusLabels:builderValueMap($("tplStatusLabels").value,true),metrics:builderMetricOrder,period:$("tplPeriod").value,comparison:$("tplComparison").value,detail:$("tplDetail").value,
    constants:builderParameters($("tplConstants").value),body:$("tplBody").value.trim()};
}
function builderTab(metric) {
  $("builderMetricPane").hidden=!metric;$("builderReportPane").hidden=metric;
  $("builderReportTab").setAttribute("aria-pressed",String(!metric));$("builderMetricsTab").setAttribute("aria-pressed",String(metric));
}
function fillMetric() {
  formulaPreviewVersion++;$("formulaTest").disabled=false;
  metricEditingId=$("metricSaved").value||undefined;
  const metric=state.metrics?.find(item=>item.id===metricEditingId);
  $("metricName").value=metric?.name||"";$("metricId").value=metric?.id||"";$("metricId").disabled=!!metric;
  $("metricFormula").value=metric?.formula||"";$("metricUnit").value=metric?.unit||"number";$("metricDecimals").value=metric?.decimals??0;$("metricScope").value=metric?.scope||"both";
  $("metricParameters").value=builderParameterText(state.parameters);
  $("metricValueMap").value=builderMapText(metric?.valueMap);
  $("metricDelete").hidden=!metric;feedback("metricFeedback");feedback("formulaResult","Chưa tính thử");
  renderFormulaInputs();
  renderFormulaPicker();
  $("formulaOperators").replaceChildren(...["+","-","*","/","(",")"].map(op=>{const button=el("button",op,"secondary");button.type="button";button.setAttribute("aria-label","Chèn phép tính "+op);button.onclick=()=>builderInsert($("metricFormula")," "+op+" ");return button;}));
  validateMetricCode();
}
function renderFormulaInputs(){
 const old=new Map([...$("formulaTestValues").querySelectorAll("input")].map(input=>[input.dataset.variable,input.value]));
 const seen=new Set(),needed=new Set();
 const visit=(text,depth=0)=>{if(depth>25)return;for(const id of text.match(/[A-Za-z][A-Za-z0-9_]*/g)||[]){if(seen.has(id))continue;seen.add(id);if(Object.hasOwn(state.baseVariables||{},id))needed.add(id);else{const metric=(state.metricDefinitions||[]).find(m=>m.id===id);if(metric)visit(metric.formula,depth+1);}}};
 visit($("metricFormula").value);if(!$("metricFormula").value.trim())for(const id of ["chi_phi","tin_nhan","so_dien_thoai"])if(Object.hasOwn(state.baseVariables||{},id))needed.add(id);
 $("formulaTestValues").replaceChildren(...[...needed].map(id=>{const label=el("label"),input=el("input");input.type="number";input.step="any";input.dataset.variable=id;input.setAttribute("aria-label","Số thử: "+state.baseVariables[id]);input.value=old.get(id)??({chi_phi:"100000",tin_nhan:"10",so_dien_thoai:"2"}[id]||"");label.append(el("span",state.baseVariables[id]),el("code",id),input);return label;}));
}
function validateMetricCode() {
  const input=$("metricId"),id=input.value.trim();
  const reserved=(state.reservedMetricIds||[]).includes(id);
  const duplicate=!metricEditingId&&(state.metricDefinitions||[]).some(metric=>metric.id===id);
  if(typeof input.setCustomValidity==="function")input.setCustomValidity(reserved?"Mã dành riêng cho nội dung mẫu. Chọn mã khác.":duplicate?"Mã chỉ số đã có. Chọn chỉ số đã lưu để sửa.":"");
}
function metricDraft() {
  return {id:$("metricId").value.trim(),name:$("metricName").value.trim(),formula:$("metricFormula").value.trim(),
    valueMap:builderValueMap($("metricValueMap").value),unit:$("metricUnit").value,decimals:Number($("metricDecimals").value),scope:$("metricScope").value};
}
async function loadReportHistory() {
  $("reloadHistory").disabled=true;feedback("reportHistoryFeedback","Đang đọc lịch sử…");
  try {
    const response=await api("report-history");
    $("reportHistoryRows").replaceChildren(...response.runs.map(run=>{
      const tr=el("tr"),date=el("td",new Date(run.at).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})),group=el("td");
      group.append(el("b",run.groupName),el("small",run.from+" → "+run.to));
      const source=el("td",({sheets:"Google Sheets",meta:"Meta Ads",hybrid:"Meta + Sheets",pancake:"Meta + Pancake POS"})[run.source]||run.source);
      const status=el("td",({prepared:"Đã chuẩn bị",preview:"Xem trước trên web",failed:"Chưa hoàn tất",sent:"Đã gửi Telegram","already-recorded":"Đã ghi nhận trước"})[run.status]||run.status);
      tr.append(date,group,source,status);return tr;
    }));
    feedback("reportHistoryFeedback",response.runs.length?"":"Chưa có lịch sử. Chạy thử một mẫu báo cáo để bắt đầu.");
  }catch(error){feedback("reportHistoryFeedback",error.message,true);}
  finally{$("reloadHistory").disabled=false;}
}
document.getElementById("metaSaved").onchange=fillMetaConnection;
document.getElementById("metaForm").onsubmit=async event=>{
  event.preventDefault();$("metaSave").disabled=true;feedback("metaFeedback","Đang kiểm tra quyền đọc tài khoản Meta…");
  const id=metaEditingId||crypto.randomUUID();
  try {
    await api("meta",{id,name:$("metaName").value.trim(),token:$("metaToken").value.trim()});
    $("metaToken").value="";metaEditingId=id;updateState(await api("state"));$("metaSaved").value=id;fillMetaConnection();
    feedback("metaFeedback","Đã xác nhận và lưu kết nối. Tài khoản có thể dùng trong Mẫu & chỉ số.");
  }catch(error){feedback("metaFeedback",error.message,true);}
  finally{$("metaToken").value="";$("metaSave").disabled=!state.canEditGroups;}
};
document.getElementById("metaRemove").onclick=async()=>{
  if(!confirm("Gỡ kết nối Meta này? Mẫu đang dùng kết nối phải đổi nguồn trước."))return;
  $("metaRemove").disabled=true;
  try{await api("meta",{id:metaEditingId,name:$("metaName").value,remove:true});metaEditingId=undefined;updateState(await api("state"));feedback("metaFeedback","Đã gỡ kết nối.");}
  catch(error){feedback("metaFeedback",error.message,true);}finally{$("metaRemove").disabled=false;}
};
document.getElementById("builderReportTab").onclick=()=>builderTab(false);
document.getElementById("builderMetricsTab").onclick=()=>builderTab(true);
document.getElementById("openMetricEditor").onclick=()=>builderTab(true);
document.getElementById("builderNewGroup").onclick=()=>{
  if(builderDirty&&!confirm("Bỏ thay đổi chưa lưu để tạo mẫu mới?"))return;
  builderCreating=true;builderGroupId=crypto.randomUUID();builderDirty=false;
  builderSelect($("tplGroup"),[...state.groups,{id:builderGroupId,name:"Mẫu mới · chưa lưu"}],builderGroupId);
  fillBuilderGroup();builderMarkDirty();location.hash="#templates";$("tplName").focus();
};
document.getElementById("tplGroup").onchange=()=>{
  if(builderDirty&&!confirm("Bỏ thay đổi mẫu chưa lưu để mở nhóm khác?")){$("tplGroup").value=builderGroupId;return;}
  builderDirty=false;builderCreating=false;builderGroupId=$("tplGroup").value;fillBuilderGroup();
};
document.getElementById("templateForm").oninput=builderMarkDirty;
document.getElementById("tplSource").onchange=()=>{
  // Source changes never remove selected metrics; unavailable inputs remain explicit in previews.
  builderSourceFields();renderBuilderChoices();builderMarkDirty();
};
document.getElementById("tplMessageAction").onchange=builderSourceFields;
document.getElementById("tplConnection").onchange=()=>{builderAccounts();builderCampaigns=[];builderCampaignIds=[];builderCampaignVersion++;$("tplLoadCampaigns").disabled=false;renderBuilderCampaigns();builderMarkDirty();};
document.getElementById("tplAccount").onchange=()=>{builderAccountInfo();builderCampaigns=[];builderCampaignIds=[];builderCampaignVersion++;$("tplLoadCampaigns").disabled=false;renderBuilderCampaigns();builderMarkDirty();};
document.getElementById("tplLoadCampaigns").onclick=loadBuilderCampaigns;
document.getElementById("tplCampaignSearch").oninput=renderBuilderCampaigns;
function builderTemplateVersion(group) {
  return JSON.stringify({name:group?.name,report:group?.report||null},(_key,value)=>
    value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value);
}
function lockTemplateSave(locked) {
  for(const id of ["templateFields","tplGroup","builderNewGroup","tplSave"])$(id).disabled=locked||!state.canEditGroups;
  for(const id of ["builderReportTab","builderMetricsTab"])$(id).disabled=locked;
}
document.getElementById("templateForm").onsubmit=async event=>{
  event.preventDefault();if(builderSaving)return;
  builderSaving=true;builderDirty=true;lockTemplateSave(true);feedback("templateFeedback","Đang kiểm tra và lưu mẫu…");
  try {
    const groupId=builderGroupId,creating=builderCreating,name=$("tplName").value.trim(),definition=templateDraft();
    const fresh=await api("state"),group=fresh.groups.find(item=>item.id===groupId);
    if(creating&&group)throw Error("Mã mẫu mới đã tồn tại; bản đang chỉnh vẫn được giữ.");
    if(!creating&&!group)throw Error("Nhóm này đã bị gỡ. Nội dung đang chỉnh vẫn được giữ để bạn chuyển sang nhóm khác.");
    if(!creating&&builderTemplateVersion(group)!==builderBase)throw Error("Mẫu này đã được chỉnh ở nơi khác. Nội dung của bạn vẫn được giữ; đối chiếu với bản đã lưu trước khi lưu lại.");
    // Refresh unrelated settings/revisions while setupBuilder keeps this draft.
    updateState(fresh);lockTemplateSave(true);
    const saved=await api("report-definition",{groupId,name,definition,...(creating?{create:true}:{}),revision:fresh.revision});
    if(!saved.saved||!Number.isInteger(saved.revision)||saved.group?.id!==groupId)throw Error("Chưa nhận đủ xác nhận lưu. Giữ nội dung đang chỉnh và kiểm tra bản đã lưu.");
    const groups=creating?[...fresh.groups,saved.group]:fresh.groups.map(item=>item.id===groupId?{...item,...saved.group}:item);
    builderDirty=false;builderCreating=false;updateState({...fresh,groups,revision:saved.revision});
    feedback("templateFeedback","Đã lưu. Bot và lịch gửi dùng cấu hình mới ở lần chạy tiếp theo.");
  }catch(error){feedback("templateFeedback",error.message,true);}finally{builderSaving=false;lockTemplateSave(false);}
};
document.getElementById("tplReset").onclick=async()=>{
  if(!confirm("Bỏ cấu hình mẫu riêng và dùng báo cáo Sheets mặc định?"))return;
  $("tplReset").disabled=true;
  try{await api("report-definition",{groupId:builderGroupId,reset:true,revision:state.revision});builderDirty=false;updateState(await api("state"));feedback("templateFeedback","Đã về mẫu Sheets mặc định.");}
  catch(error){feedback("templateFeedback",error.message,true);}finally{$("tplReset").disabled=false;}
};
document.getElementById("tplPreviewMode").onchange=()=>{
  const range=$("tplPreviewMode").value==="range";$("tplRangeBox").hidden=!range;$("tplAnchorBox").hidden=range;
  $("tplAnchor").required=!range;$("tplFrom").required=range;$("tplTo").required=range;builderPreviewVersion++;$("tplPreview").disabled=false;
};
document.getElementById("templatePreviewForm").oninput=()=>{
  builderPreviewVersion++;$("tplPreview").disabled=false;
  feedback("templatePreviewFeedback","Khoảng ngày đã đổi. Chạy thử lại để lấy đúng dữ liệu.");
};
document.getElementById("templatePreviewForm").onsubmit=async event=>{
  event.preventDefault();if(!$("templateForm").reportValidity())return;
  const version=++builderPreviewVersion;$("tplPreview").disabled=true;feedback("templatePreviewFeedback","Đang đọc nguồn và tính chỉ số…");
  try {
    const dates=$("tplPreviewMode").value==="range"?{from:$("tplFrom").value,to:$("tplTo").value}:{anchor:$("tplAnchor").value};
    const result=await api("template-preview",{groupId:builderGroupId,...(builderCreating?{create:true}:{}),name:$("tplName").value.trim(),definition:templateDraft(),...dates});
    if(version!==builderPreviewVersion)return;
    $("templatePreviewText").textContent=result.text;
    $("templatePreviewMetrics").replaceChildren(...(result.report.metricValues||[]).filter(metric=>metric.value===null&&!metric.untracked).map(metric=>el("p",metric.name+": "+metric.reason,"hint")));
    feedback("templatePreviewFeedback","Đã đọc dữ liệu thật · "+result.text.length+"/4000 ký tự · Chưa gửi Telegram.");
  }catch(error){if(version===builderPreviewVersion)feedback("templatePreviewFeedback",error.message,true);}
  finally{if(version===builderPreviewVersion)$("tplPreview").disabled=false;}
};
document.getElementById("metricSaved").onchange=()=>{
  if(metricDirty&&!confirm("Bỏ thay đổi công thức chưa lưu?")){$("metricSaved").value=metricEditingId||"";return;}
  metricDirty=false;fillMetric();
};
document.getElementById("newMetric").onclick=()=>{if(metricDirty&&!confirm("Bỏ thay đổi công thức chưa lưu?"))return;metricDirty=false;$("metricSaved").value="";fillMetric();$("metricName").focus();};
function invalidateFormulaPreview() {
  formulaPreviewVersion++;$("formulaTest").disabled=false;
  feedback("formulaResult","Đầu vào đã đổi. Tính thử lại để kiểm tra.");
}
document.getElementById("metricForm").oninput=()=>{metricDirty=true;validateMetricCode();renderFormulaInputs();invalidateFormulaPreview();};
document.getElementById("formulaTestValues").oninput=invalidateFormulaPreview;
document.getElementById("metricForm").onsubmit=async event=>{
  event.preventDefault();$("metricSave").disabled=true;feedback("metricFeedback","Đang kiểm tra công thức và tham chiếu…");
  try {
    const metric=metricDraft();await api("metric",{metric,editingId:metricEditingId,parameters:builderParameters($("metricParameters").value),revision:state.revision});
    metricDirty=false;metricEditingId=metric.id;updateState(await api("state"));
    feedback("metricFeedback","Đã lưu chỉ số. Chọn chỉ số này trong mẫu báo cáo để sử dụng.");
  }catch(error){feedback("metricFeedback",error.message,true);}finally{$("metricSave").disabled=!state.canEditGroups;}
};
document.getElementById("metricDelete").onclick=async()=>{
  if(!confirm("Xoá chỉ số này? Chỉ xoá được khi không còn mẫu hoặc công thức nào tham chiếu."))return;
  $("metricDelete").disabled=true;
  try{await api("metric",{id:metricEditingId,remove:true,revision:state.revision});metricDirty=false;metricEditingId=undefined;updateState(await api("state"));feedback("metricFeedback","Đã xoá chỉ số.");}
  catch(error){feedback("metricFeedback",error.message,true);}finally{$("metricDelete").disabled=false;}
};
document.getElementById("formulaTest").onclick=async()=>{
  if(!$("metricForm").reportValidity())return;
  const version=++formulaPreviewVersion;
  $("formulaTest").disabled=true;feedback("formulaResult","Đang tính thử…");
  try {
    const values=Object.fromEntries([...$("formulaTestValues").querySelectorAll("input")].map(input=>[input.dataset.variable,input.value===""?null:Number(input.value)]));
    const response=await api("formula-preview",{formula:$("metricFormula").value,metric:metricDraft(),values,parameters:builderParameters($("metricParameters").value)});
    if(version!==formulaPreviewVersion)return;
    const result=response.result;
    const mapped=result.value!==null?metricDraft().valueMap?.[String(result.value)]:undefined;
    feedback("formulaResult",result.value===null?"Không tính được · "+result.reason:mapped?String(result.value)+" → "+mapped:new Intl.NumberFormat("vi-VN",{maximumFractionDigits:Number($("metricDecimals").value)}).format(result.value)+($("metricUnit").value==="percent"?"%":$("metricUnit").value==="currency"?" (đơn vị tiền của báo cáo)":""));
  }catch(error){if(version===formulaPreviewVersion)feedback("formulaResult",error.message,true);}finally{if(version===formulaPreviewVersion)$("formulaTest").disabled=false;}
};
document.getElementById("reloadHistory").onclick=loadReportHistory;
window.addEventListener("beforeunload",event=>{if(builderDirty||metricDirty){event.preventDefault();event.returnValue="";}});

if(document.getElementById("tplPosConnection"))document.getElementById("tplPosConnection").onchange=()=>{fillSalesTemplateShops();builderMarkDirty();};

document.getElementById("tplMetricSearch").oninput=renderBuilderChoices;
document.getElementById("tplPlaceholderSearch").oninput=renderBuilderChoices;
document.getElementById("formulaVariableSearch").oninput=renderFormulaPicker;
document.getElementById("tplAddMetric").onclick=()=>{
 const id=$("tplMetricSelect").value;if(!id)return;
 if(builderMetricOrder.length>=60){feedback("templateFeedback","Chọn tối đa 60 chỉ số trong một mẫu.",true);return;}
 builderMetricOrder=[...new Set([...builderMetricOrder,id])];builderMarkDirty();renderBuilderChoices();
};
document.getElementById("tplInsertPlaceholder").onclick=()=>{const id=$("tplPlaceholderSelect").value;if(id)builderInsert($("tplBody"),"{{"+id+"}}");};
document.getElementById("formulaInsertVariable").onclick=()=>{const id=$("formulaVariableSelect").value;if(id)builderInsert($("metricFormula"),id);};
