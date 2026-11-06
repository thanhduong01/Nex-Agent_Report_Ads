import { readPrivate, updatePrivate } from "./private-store.ts";
type Run={at:string;groupId:string;groupName:string;from:string;to:string;source:string;status:"prepared"|"preview"|"failed"|"sent"|"already-recorded";mode:"query"|"bot"|"schedule"|"web"};
export async function reportHistory() {return (await readPrivate<Run[]>("report-history",[])).slice(0,50);}
export async function recordReportRun(run:Omit<Run,"at">) {
  try {await updatePrivate<Run[]>("report-history",[],items=>{items.unshift({...run,at:new Date().toISOString()});items.splice(50);});}
  catch {console.warn("Report history unavailable");}
}
