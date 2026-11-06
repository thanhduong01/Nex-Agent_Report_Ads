import { GroupError } from "./groups.ts";
const buckets=new Map<string,{until:number;count:number}>();
export function limitAdminOperation(operation:string,limit=30) {
  const now=Date.now();
  for(const [key,value] of buckets)if(value.until<=now)buckets.delete(key);
  const bucket=buckets.get(operation)||{until:now+60000,count:0};
  if(++bucket.count>limit)throw new GroupError("Thao tác quá nhanh. Đợi một phút rồi thử lại.",429);
  buckets.set(operation,bucket);
}
