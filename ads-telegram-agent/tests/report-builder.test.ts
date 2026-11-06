import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script=await readFile(new URL("../public/report-builder.js",import.meta.url),"utf8");
const markup=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
type Call={path:string;body:any};
class Element {
  children:Element[]=[]; dataset:Record<string,string>={}; attributes:Record<string,string>={};
  hidden=false;required=false;disabled=false;checked=false;type="";textContent="";className="";id="";
  parent?:Element;oninput?:Function;onchange?:Function;onclick?:Function;onsubmit?:Function;
  handlers:Record<string,Function[]>={};_value="";selectionStart=0;selectionEnd=0;
  classList={toggle(){}};
  tagName:string;
  constructor(tagName="div"){this.tagName=tagName;}
  get value(){return this._value;}set value(value:any){this._value=String(value);}
  append(...children:Element[]){for(const child of children){this.children.push(child);child.parent=this;}}
  replaceChildren(...children:Element[]){this.children=[];this.append(...children);}
  setAttribute(key:string,value:string){this.attributes[key]=value;}
  removeAttribute(key:string){delete this.attributes[key];}
  addEventListener(type:string,handler:Function){(this.handlers[type]??=[]).push(handler);}
  dispatchEvent(event:{type:string;bubbles?:boolean}) {
    const handler=(this as any)["on"+event.type];handler?.(event);
    for(const listener of this.handlers[event.type]||[])listener(event);
    if(event.bubbles)this.parent?.dispatchEvent(event);
    return true;
  }
  querySelectorAll(query:string):Element[]{
    const children=this.children.flatMap(child=>[child,...child.querySelectorAll(query)]);
    return children.filter(child=>query==="input"?child.tagName==="input":query==="input:checked"?child.tagName==="input"&&child.checked:query==="button"?child.tagName==="button":false);
  }
  reportValidity(){return true;}focus(){}setSelectionRange(start:number,end:number){this.selectionStart=start;this.selectionEnd=end;}
}
function fixture(){
  const metrics=[
    {id:"cost",name:"Chi phí",formula:"chi_phi",scope:"both"},
    {id:"messages",name:"Tin nhắn",formula:"tin_nhan",scope:"both"},
    {id:"phones",name:"SĐT",formula:"so_dien_thoai",scope:"both"},
    {id:"cost_per_message",name:"CP/tin",formula:"chi_phi / tin_nhan",scope:"both"}
  ].map(metric=>({...metric,unit:"number",decimals:0}));
  return {canEditGroups:true,defaultDate:"2026-11-05",revision:7,metrics:[],metricDefinitions:metrics,
    parameters:{phi:100},baseVariables:{chi_phi:"Chi phí",tin_nhan:"Tin nhắn",so_dien_thoai:"SĐT"},
    metaConnections:[{id:"meta",name:"Test connection",checkedAt:"2026-11-06T01:00:00Z",accounts:[{id:"act_1001",name:"Test account",currency:"VND",timezone_name:"Asia/Ho_Chi_Minh"}]}],
    groups:[{id:"tour",name:"Tour",sources:{"2026-11":{mappings:[{name:"Tour"}]}}}]};
}
function client(handler?:(call:Call)=>Promise<any>){
  const nodes:Record<string,Element>={};
  for(const match of markup.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)){
    const node=new Element(match[1]);node.id=match[2];node.hidden=/\bhidden(?:\s|>|=)/.test(match[0]);nodes[node.id]=node;
  }
  const $=(id:string)=>{assert(nodes[id],"Missing authored DOM element: "+id);return nodes[id];};
  for(const id of ["tplAnchor","tplFrom","tplTo","tplPreviewMode"])$(id).parent=$("templatePreviewForm");
  for(const id of ["metricName","metricId","metricFormula","metricUnit","metricDecimals","metricScope","metricParameters"])$(id).parent=$("metricForm");
  for(const id of ["tplName","tplSource","tplPeriod","tplComparison","tplDetail","tplConstants","tplBody"])$(id).parent=$("templateForm");
  $("tplPreviewMode").value="preset";$("metricDecimals").value="0";
  const data=fixture(),calls:Call[]=[];
  const scope=vm.createContext({$,document:{getElementById:$},state:data,location:{hash:"#templates"},confirm:()=>true,crypto:{randomUUID:()=>"test-id"},
    window:{addEventListener(){}},Event,console,Option:class extends Element{constructor(name:string,value:string){super("option");this.textContent=name;this.value=value;}},
    el:(tag:string,text?:string,cls?:string)=>{const node=new Element(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;},
    feedback:(id:string,text="",error=false)=>{$(id).textContent=text;$(id).attributes.error=String(error);},
    api:async(path:string,body:any)=>{const call={path,body:body===undefined?undefined:JSON.parse(JSON.stringify(body))};calls.push(call);return handler?handler(call):path==="state"?data:{saved:true};},
    updateState:(next:any)=>{scope.state=next;vm.runInContext("setupBuilder(state)",scope);}
  });
  vm.runInContext(script,scope);vm.runInContext("setupBuilder(state)",scope);
  return {nodes,calls,$,scope,run:(code:string)=>vm.runInContext(code,scope),
    input:(id:string,value:string)=>{$(id).value=value;$(id).dispatchEvent(new Event("input",{bubbles:true}));},
    change:(id:string,value:string)=>{$(id).value=value;$(id).dispatchEvent(new Event("change",{bubbles:true}));},
    submit:(id:string)=>$(id).onsubmit!({preventDefault(){}})};
}

test("builder source switches only require controls for the selected source and keeps formula order in save payload",async()=>{
  const ui=client();
  assert.equal(ui.$("tplMetaFields").hidden,true);assert.equal(ui.$("tplConnection").required,false);
  ui.change("tplSource","meta");
  assert.equal(ui.$("tplConnection").required,true);assert.equal(ui.$("tplPhoneProduct").required,false);
  ui.change("tplSource","hybrid");assert.equal(ui.$("tplPhoneProduct").required,true);
  ui.change("tplSource","sheets");assert.equal(ui.$("tplPhoneProduct").required,false);assert.equal(ui.$("tplAccount").required,false);
  ui.input("tplConstants","phi = 25");
  const firstChoice=ui.$("tplMetricList").children[0],down=firstChoice.children[1].children[1];down.onclick!();
  await ui.submit("templateForm");
  const saved=ui.calls.find(call=>call.path==="report-definition")!;
  assert.equal(saved.body.revision,7);assert.equal(saved.body.definition.constants.phi,25);
  assert.deepEqual(saved.body.definition.metrics,["messages","cost","cost_per_message"]);
  assert.equal(saved.body.definition.source,"sheets");assert.equal(saved.body.definition.connectionId,undefined);
});
test("metric save and calculation submit exact formulas and preserve blank test operands as null",async()=>{
  const ui=client(async call=>call.path==="formula-preview"?{result:{value:null,reason:"Thiếu số liệu"}}:call.path==="state"?fixture():{saved:true});
  ui.input("metricName","Chi phí sau phí");ui.input("metricId","sau_phi");ui.input("metricFormula","chi_phi + phi");
  ui.change("metricUnit","currency");ui.change("metricScope","total");ui.input("metricParameters","phi = 25");
  const testInput=ui.$("formulaTestValues").querySelectorAll("input").find(input=>input.dataset.variable==="chi_phi")!;testInput.value="";
  await ui.$("formulaTest").onclick!();
  const preview=ui.calls.find(call=>call.path==="formula-preview")!;
  assert.equal(preview.body.values.chi_phi,null);assert.equal(preview.body.metric.formula,"chi_phi + phi");assert.equal(preview.body.parameters.phi,25);
  assert.match(ui.$("formulaResult").textContent,/Không tính được/);
  await ui.submit("metricForm");
  const saved=ui.calls.find(call=>call.path==="metric")!;
  assert.equal(saved.body.metric.scope,"total");assert.equal(saved.body.metric.unit,"currency");
  assert.equal(saved.body.revision,7);
});
test("template preview ignores a pending response after its selected date is edited",async()=>{
  let finish!:(value:any)=>void;
  const ui=client(call=>call.path==="template-preview"?new Promise(resolve=>{finish=resolve;}):Promise.resolve(fixture()));
  const pending=ui.submit("templatePreviewForm");
  ui.input("tplAnchor","2026-11-01");
  finish({text:"OUTDATED REPORT",report:{metricValues:[]}});await pending;
  assert.notEqual(ui.$("templatePreviewText").textContent,"OUTDATED REPORT");
});
test("formula preview ignores a pending result after the expression is edited",async()=>{
  let finish!:(value:any)=>void;
  const ui=client(call=>call.path==="formula-preview"?new Promise(resolve=>{finish=resolve;}):Promise.resolve(fixture()));
  ui.input("metricName","Ratio");ui.input("metricId","ratio");ui.input("metricFormula","chi_phi / tin_nhan");
  const pending=ui.$("formulaTest").onclick!();
  ui.input("metricFormula","chi_phi * 2");
  finish({result:{value:999999}});await pending;
  assert.doesNotMatch(ui.$("formulaResult").textContent,/999/);
});
test("newly saved metric becomes selectable without discarding a dirty template draft",()=>{
  const ui=client();
  ui.input("tplName","Tên đang chỉnh");
  ui.run('state.metricDefinitions.push({id:"sau_phi",name:"Chi phí sau phí",formula:"chi_phi + phi",scope:"both",unit:"currency",decimals:0}); state.metrics.push(state.metricDefinitions.at(-1)); setupBuilder(state);');
  assert.equal(ui.$("tplName").value,"Tên đang chỉnh");
  const metricLabels=ui.$("tplMetricList").children.map(row=>row.children[0].children[1].children[0].textContent);
  assert(metricLabels.includes("Chi phí sau phí"),"New metric must be available while the user's unsaved template stays intact");
  assert.equal(ui.$("templateSaveState").textContent,"Chưa lưu");
});
test("deleting a metric removes its unsaved selection without losing the rest of the template draft",async()=>{
  const ui=client();
  ui.run('state.metricDefinitions.push({id:"sau_phi",name:"After fee",formula:"chi_phi + phi",scope:"both",unit:"currency",decimals:0}); state.metrics.push(state.metricDefinitions.at(-1)); setupBuilder(state);');
  const row=ui.$("tplMetricList").children.find(row=>row.children[0].children[1].children[0].textContent==="After fee")!;
  const checkbox=row.children[0].children[0];checkbox.checked=true;checkbox.onchange!();
  ui.input("tplName","Giữ nội dung đang chỉnh");
  ui.run('state.metricDefinitions=state.metricDefinitions.filter(metric=>metric.id!=="sau_phi"); state.metrics=[]; setupBuilder(state);');
  await ui.submit("templateForm");
  const saved=ui.calls.find(call=>call.path==="report-definition")!;
  assert(!saved.body.definition.metrics.includes("sau_phi"));
  assert.equal(saved.body.name,"Giữ nội dung đang chỉnh");
});
