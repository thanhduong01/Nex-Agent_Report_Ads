import { shiftDate, validateDate } from "./report.ts";
import type { ReportDefinition } from "./report-definition.ts";
export function resolvePeriod(anchor:string,period:ReportDefinition["period"]="today",from?:string) {
  validateDate(anchor);let to=anchor,start=from;
  if(!start) {
    if(period==="yesterday")to=shiftDate(anchor,-1);
    start=period==="last7"?shiftDate(to,-6):period==="month"?to.slice(0,7)+"-01":to;
  }
  validateDate(start);
  const days=(Date.parse(to)-Date.parse(start))/86400000+1;
  if(days<1)throw new Error("Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.");
  if(days>93)throw new Error("Báo cáo tối đa 93 ngày mỗi lần.");
  return {from:start,to};
}
export function previousPeriod(range:{from:string;to:string}) {
  const days=(Date.parse(range.to)-Date.parse(range.from))/86400000+1;
  return {from:shiftDate(range.from,-days),to:shiftDate(range.from,-1)};
}
