"use strict";
let builderGroupId, builderDirty=false, metricDirty=false, metaEditingId, metricEditingId;
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
  builderGroupId=data.groups.some(group=>group.id===builderGroupId)?builderGroupId:data.groups[0]?.id;
  builderSelect($("tplGroup"),data.groups,builderGroupId);
  $("templateFields").disabled=!data.canEditGroups||!builderGroupId;
  if(!builderDirty)fillBuilderGroup();
  else {
    const selectedConnection=$("tplConnection").value,selectedAccount=$("tplAccount").value;
    builderSelect($("tplConnection"),data.metaConnections||[],selectedConnection,"Chọn kết nối");
    builderMetricOrder=builderMetricOrder.filter(id=>(data.metricDefinitions||[]).some(metric=>metric.id===id));
    builderAccounts(selectedAccount);renderBuilderChoices();
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
  builderMetricOrder=[...(definition?.metrics||["cost","messages","phones","cost_per_message"])];
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  $("tplAnchor").value=today;$("tplFrom").value=today;$("tplTo").value=today;
  $("templateSaveState").textContent=definition?"Đã lưu":"Mẫu Sheets hiện tại";$("templateSaveState").className="pill";
  $("tplReset").hidden=!definition;
  $("templatePreviewText").textContent="Chọn nguồn, chỉ số và chạy thử để xem báo cáo.";
  $("templatePreviewMetrics").replaceChildren();feedback("templateFeedback");feedback("templatePreviewFeedback");
  builderPreviewVersion++;$("tplPreview").disabled=false;renderBuilderChoices();builderSourceFields();renderBuilderCampaigns();
}
function builderSourceFields() {
  const source=$("tplSource").value;
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
  const definitions=state.metricDefinitions||[];
  const order=[...builderMetricOrder,...definitions.map(metric=>metric.id).filter(id=>!builderMetricOrder.includes(id))];
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
  const variables=["ten_nhom","ky_bao_cao","chi_so","chi_tiet","so_sanh","nguon","thoi_diem_doc","mui_gio",...builderMetricOrder.filter(id=>definitions.find(metric=>metric.id===id)?.scope!=="row")];
  $("tplPlaceholders").replaceChildren(...variables.map(name=>{const button=el("button","{{"+name+"}}","variableButton");button.type="button";button.onclick=()=>builderInsert($("tplBody"),"{{"+name+"}}");return button;}));
}
function templateDraft() {
  const source=$("tplSource").value;
  if(!builderMetricOrder.length)throw Error("Chọn ít nhất một chỉ số.");
  if(source!=="sheets"&&!builderCampaignIds.length)throw Error("Chọn ít nhất một campaign cho mẫu.");
  if(builderCampaignIds.length>100)throw Error("Tối đa 100 campaign trong một mẫu.");
  return {source,...(source!=="sheets"?{connectionId:$("tplConnection").value,accountId:$("tplAccount").value,campaignIds:builderCampaignIds,
    messageAction:$("tplMessageAction").value==="custom"?$("tplMessageCustom").value.trim():$("tplMessageAction").value}:{}),
    ...(source==="hybrid"?{phoneSheetName:$("tplPhoneProduct").value}:{}),
    metrics:builderMetricOrder,period:$("tplPeriod").value,comparison:$("tplComparison").value,detail:$("tplDetail").value,
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
  $("metricDelete").hidden=!metric;feedback("metricFeedback");feedback("formulaResult","Chưa tính thử");
  const oldValues=new Map([...$("formulaTestValues").querySelectorAll("input")].map(input=>[input.dataset.variable,input.value]));
  $("formulaTestValues").replaceChildren(...Object.entries(state.baseVariables||{}).map(([id,name])=>{
    const label=el("label"),input=el("input");input.type="number";input.step="any";input.dataset.variable=id;input.setAttribute("aria-label","Số thử: "+name);
    input.value=oldValues.get(id)??({chi_phi:"100000",tin_nhan:"10",so_dien_thoai:"2"}[id]||"");
    label.append(el("span",name),el("code",id),input);return label;
  }));
  const variables=[...Object.keys(state.baseVariables||{}),...Object.keys(state.parameters||{}),...(state.metrics||[]).filter(item=>item.id!==metricEditingId).map(item=>item.id)];
  $("formulaVariables").replaceChildren(...variables.map(name=>{const button=el("button",name,"variableButton");button.type="button";button.onclick=()=>builderInsert($("metricFormula"),name);return button;}));
  validateMetricCode();
}
function validateMetricCode() {
  const input=$("metricId"),id=input.value.trim();
  const reserved=(state.reservedMetricIds||[]).includes(id);
  const duplicate=!metricEditingId&&(state.metricDefinitions||[]).some(metric=>metric.id===id);
  if(typeof input.setCustomValidity==="function")input.setCustomValidity(reserved?"Mã dành riêng cho nội dung mẫu. Chọn mã khác.":duplicate?"Mã chỉ số đã có. Chọn chỉ số đã lưu để sửa.":"");
}
function metricDraft() {
  return {id:$("metricId").value.trim(),name:$("metricName").value.trim(),formula:$("metricFormula").value.trim(),
    unit:$("metricUnit").value,decimals:Number($("metricDecimals").value),scope:$("metricScope").value};
}
async function loadReportHistory() {
  $("reloadHistory").disabled=true;feedback("reportHistoryFeedback","Đang đọc lịch sử…");
  try {
    const response=await api("report-history");
    $("reportHistoryRows").replaceChildren(...response.runs.map(run=>{
      const tr=el("tr"),date=el("td",new Date(run.at).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})),group=el("td");
      group.append(el("b",run.groupName),el("small",run.from+" → "+run.to));
      const source=el("td",({sheets:"Google Sheets",meta:"Meta Ads",hybrid:"Meta + Sheets"})[run.source]||run.source);
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
document.getElementById("builderNewGroup").onclick=()=>{location.hash="#settings";$("newGroup").click();};
document.getElementById("tplGroup").onchange=()=>{
  if(builderDirty&&!confirm("Bỏ thay đổi mẫu chưa lưu để mở nhóm khác?")){$("tplGroup").value=builderGroupId;return;}
  builderDirty=false;builderGroupId=$("tplGroup").value;fillBuilderGroup();
};
document.getElementById("templateForm").oninput=builderMarkDirty;
document.getElementById("tplSource").onchange=()=>{
  if($("tplSource").value==="meta")builderMetricOrder=builderMetricOrder.filter(id=>!["phones","cost_per_phone","phone_rate"].includes(id));
  builderSourceFields();renderBuilderChoices();builderMarkDirty();
};
document.getElementById("tplMessageAction").onchange=builderSourceFields;
document.getElementById("tplConnection").onchange=()=>{builderAccounts();builderCampaigns=[];builderCampaignIds=[];builderCampaignVersion++;$("tplLoadCampaigns").disabled=false;renderBuilderCampaigns();builderMarkDirty();};
document.getElementById("tplAccount").onchange=()=>{builderAccountInfo();builderCampaigns=[];builderCampaignIds=[];builderCampaignVersion++;$("tplLoadCampaigns").disabled=false;renderBuilderCampaigns();builderMarkDirty();};
document.getElementById("tplLoadCampaigns").onclick=loadBuilderCampaigns;
document.getElementById("tplCampaignSearch").oninput=renderBuilderCampaigns;
document.getElementById("templateForm").onsubmit=async event=>{
  event.preventDefault();$("tplSave").disabled=true;feedback("templateFeedback","Đang kiểm tra và lưu mẫu…");
  try {
    const definition=templateDraft();await api("report-definition",{groupId:builderGroupId,name:$("tplName").value.trim(),definition,revision:state.revision});
    builderDirty=false;updateState(await api("state"));feedback("templateFeedback","Đã lưu. Bot và lịch gửi dùng cấu hình mới ở lần chạy tiếp theo.");
  }catch(error){feedback("templateFeedback",error.message,true);}finally{$("tplSave").disabled=!state.canEditGroups;}
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
    const result=await api("template-preview",{groupId:builderGroupId,name:$("tplName").value.trim(),definition:templateDraft(),...dates});
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
document.getElementById("metricForm").oninput=()=>{metricDirty=true;validateMetricCode();invalidateFormulaPreview();};
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
    feedback("formulaResult",result.value===null?"Không tính được · "+result.reason:new Intl.NumberFormat("vi-VN",{maximumFractionDigits:Number($("metricDecimals").value)}).format(result.value)+($("metricUnit").value==="percent"?"%":$("metricUnit").value==="currency"?" (đơn vị tiền của báo cáo)":""));
  }catch(error){if(version===formulaPreviewVersion)feedback("formulaResult",error.message,true);}finally{if(version===formulaPreviewVersion)$("formulaTest").disabled=false;}
};
document.getElementById("reloadHistory").onclick=loadReportHistory;
window.addEventListener("beforeunload",event=>{if(builderDirty||metricDirty){event.preventDefault();event.returnValue="";}});
