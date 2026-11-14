import { z } from "zod";
import { GroupError, getRegistry, updateRegistry } from "./groups.ts";
import { baseVariables, calculateFormula, evaluateMetrics, validateMetrics } from "./formulas.ts";
import { metricSchema, parametersSchema, defaultMetrics } from "./report-definition.ts";
import { createConfiguredReport, metricDefinitions, renderConfiguredReport, validateReportDefinition } from "./report-service.ts";
import { resolvePeriod } from "./report-period.ts";
import { vietnamDate } from "./schedule-config.ts";
import { metaCampaigns } from "./meta.ts";
import { recordReportRun } from "./report-history.ts";
import {pancakeConnection} from "./pancake/connections.ts";

function revision(body:Record<string,unknown>) {
  if(!Number.isInteger(body.revision))throw new GroupError("Tải lại cấu hình trước khi lưu.");
  return body.revision as number;
}
export async function reportManagement(path:string,body:Record<string,unknown>) {
  const registry=await getRegistry();
  if(path==="/api/formula-preview") {
    const input=z.object({formula:z.string().min(1).max(512),values:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),z.number().finite().nullable()).refine(values=>Object.keys(values).length<=60),
      metric:metricSchema.optional(),parameters:parametersSchema.optional()}).safeParse(body);
    if(!input.success)throw new GroupError("Kiểm tra công thức và các biến chạy thử.");
    const values={...(input.data.parameters??registry.parameters??{}),...input.data.values};
    try {
      if(input.data.metric) {
        const definitions=metricDefinitions({...registry,metrics:[...(registry.metrics||[]).filter(metric=>metric.id!==input.data.metric!.id),input.data.metric]});
        const allowed=[...Object.keys(baseVariables),...Object.keys(values)];
        validateMetrics(definitions,allowed.filter(key=>!Object.hasOwn(baseVariables,key)));
        return {result:evaluateMetrics(definitions,values)[input.data.metric.id]};
      }
      const definitions=[...(registry.metrics||[]),{id:"preview_result",formula:input.data.formula}];
      validateMetrics([...defaultMetrics,...definitions],Object.keys(values).filter(key=>!Object.hasOwn(baseVariables,key)));
      return {result:evaluateMetrics([...defaultMetrics,...definitions],values).preview_result};
    }catch(error){throw new GroupError((error as Error).message);}
  }
  if(path==="/api/metric") {
    const parameters=parametersSchema.safeParse(body.parameters??registry.parameters??{});
    if(!parameters.success)throw new GroupError("Biến cố định phải có tên hợp lệ và giá trị số hữu hạn.");
    if(Object.keys(parameters.data).some(key=>Object.hasOwn(baseVariables,key)||["constructor","prototype","__proto__"].includes(key)))
      throw new GroupError("Tên biến cố định trùng với biến nguồn hoặc tên dành riêng.");
    const metrics=[...(registry.metrics||[])];
    const oldIndex=metrics.findIndex(metric=>metric.id===body.id);
    if(body.remove===true) {
      if(oldIndex<0)throw new GroupError("Không tìm thấy chỉ số.");
      if(registry.groups.some(group=>group.report?.metrics.includes(String(body.id))||group.report?.body.includes("{{"+body.id+"}}")))
        throw new GroupError("Chỉ số đang được dùng trong mẫu báo cáo. Bỏ chỉ số khỏi mẫu trước khi xóa.");
      metrics.splice(oldIndex,1);
    } else if(body.metric) {
      const parsed=metricSchema.safeParse(body.metric);
      if(!parsed.success)throw new GroupError("Kiểm tra tên, mã, công thức, đơn vị và số chữ số.");
      const at=metrics.findIndex(metric=>metric.id===parsed.data.id);
      if(typeof body.editingId==="string"&&body.editingId!==parsed.data.id)throw new GroupError("Không đổi mã của chỉ số đang sửa. Tạo chỉ số mới nếu cần mã khác.");
      if(at>=0&&body.editingId!==parsed.data.id)throw new GroupError("Mã chỉ số đã tồn tại. Chọn chỉ số đã lưu để sửa.");
      if(at>=0)metrics[at]=parsed.data;else metrics.push(parsed.data);
    }
    if(metrics.length>25)throw new GroupError("Tối đa 25 chỉ số tự tính. Sửa chỉ số đã có hoặc gỡ chỉ số không dùng.");
    const draft={...registry,metrics,parameters:parameters.data};
    try {
      validateMetrics(metricDefinitions(draft),Object.keys(parameters.data));
      for(const group of draft.groups)if(group.report)validateReportDefinition(group.report,draft);
    }catch(error){throw new GroupError((error as Error).message);}
    await updateRegistry(revision(body),value=>{value.metrics=metrics;value.parameters=parameters.data;});
    console.info("Custom report metrics updated",{count:metrics.length});
    return {saved:true};
  }
  const creating=body.create===true;
  const existing=registry.groups.find(group=>group.id===body.groupId);
  if(creating&&existing)throw new GroupError("Mã mẫu mới đã tồn tại. Tạo mẫu mới với mã khác; mẫu hiện tại được giữ nguyên.",409);
  if(creating&&(typeof body.groupId!=="string"||!/^[a-z0-9-]{1,64}$/.test(body.groupId)))throw new GroupError("Mã nhóm mới không hợp lệ.");
  const group=existing||(creating?{id:body.groupId as string,name:"",enabled:false,sources:{},schedule:{enabled:false,time:"09:00",days:[0,1,2,3,4,5,6],reportDay:"today" as const}}:undefined);
  if(!group)throw new GroupError("Chọn nhóm báo cáo đã lưu.",404);
  const name=body.name===undefined?group.name:typeof body.name==="string"?body.name.trim():"";
  if(!name||name.length>80)throw new GroupError("Tên mẫu báo cáo dài từ 1 đến 80 ký tự.");
  if(registry.groups.some(item=>item.id!==group.id&&item.name.toLocaleLowerCase("vi")===name.toLocaleLowerCase("vi")))
    throw new GroupError("Tên nhóm/mẫu báo cáo đã được sử dụng.");
  if(body.reset===true) {
    if(creating)throw new GroupError("Lưu mẫu mới trước khi đặt lại.");
    if(!Object.keys(group.sources).length)throw new GroupError("Thêm nguồn Sheets trước khi quay lại mẫu mặc định.");
    const saved=await updateRegistry(revision(body),draft=>{delete draft.groups.find(item=>item.id===group.id)!.report;});
    return {saved:true,revision:saved.revision,group:saved.groups.find(item=>item.id===group.id)};
  }
  const definition=validateReportDefinition(body.definition,registry);
  if(path==="/api/report-definition") {
    if(definition.source==="pancake")await pancakeConnection(definition.pancakeConnectionId!,definition.shopId!);
    if(definition.source!=="sheets") {
      const campaigns=await metaCampaigns(definition.connectionId!,definition.accountId!);
      if(definition.campaignIds.some(id=>!campaigns.some(campaign=>campaign.id===id)))throw new GroupError("Campaign không thuộc tài khoản đã chọn.");
    }
    if(definition.source==="hybrid"&&!Object.keys(group.sources).length)throw new GroupError("Thêm nguồn Sheets cho nhóm trước khi ghép SĐT.");
    const saved=await updateRegistry(revision(body),draft=>{
      if(creating){
        if(draft.groups.some(item=>item.id===group.id))throw new GroupError("Mã mẫu mới đã tồn tại.",409);
        if(draft.groups.length>=30)throw new GroupError("Tối đa 30 nhóm/mẫu.");
        draft.groups.push({...group,name,report:definition});
      }else{const item=draft.groups.find(item=>item.id===group.id)!;item.report=definition;item.name=name;}
    });
    console.info("Report definition updated",{groupId:group.id,source:definition.source});
    return {saved:true,revision:saved.revision,group:saved.groups.find(item=>item.id===group.id)};
  }
  if(path!=="/api/template-preview")throw new GroupError("Không tìm thấy thao tác.",404);
  let range;
  try {range=body.from?resolvePeriod(String(body.to||vietnamDate()),"today",String(body.from)):resolvePeriod(typeof body.anchor==="string"?body.anchor:vietnamDate(),definition.period);}
  catch(error){throw new GroupError((error as Error).message);}
  const report=await createConfiguredReport({...group,name,report:definition},registry,range);
  const text=renderConfiguredReport(report,definition);
  await recordReportRun({groupId:group.id,groupName:group.name,from:range.from,to:range.to,source:definition.source,status:"preview",mode:"web"});
  return {report,text};
}
