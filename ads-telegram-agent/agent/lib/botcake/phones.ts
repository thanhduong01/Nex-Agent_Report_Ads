export function normalizePhone(value:unknown):string|null{
 if(typeof value!=='string'||value.length>80||!/^[\d+() .\s-]+$/.test(value))return null;
 let v=value.replace(/[() .\s-]/g,'');
 if(v.startsWith('00'))v='+'+v.slice(2);
 if(v.startsWith('0'))v='+84'+v.slice(1);
 else if(v.startsWith('84'))v='+'+v;
 if(!/^\+[1-9]\d{7,14}$/.test(v))return null;
 if(v.startsWith('+84')&&!/^\+84(?:[35789]\d{8}|2\d{9})$/.test(v))return null;
 return v;
}
export function phoneValues(value:unknown):string[]{
 let values:unknown[]=Array.isArray(value)?value:[value];
 if(typeof value==='string'){
  if(value.trim().startsWith('[')){try{const parsed=JSON.parse(value);values=Array.isArray(parsed)?parsed:[value];}catch{return [];}}
  else values=value.split(/[,;\n]/);
 }
 if(values.length>30)throw new Error('Botcake: trường SĐT có quá nhiều giá trị. Kiểm tra trường đã chọn.');
 return [...new Set(values.map(normalizePhone).filter((v):v is string=>v!==null))];
}
export function utcTime(value:unknown):string|null{
 if(typeof value!=='string'||value.length>40)return null;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
 if(!m)return null;
 const y=+m[1],month=+m[2],day=+m[3];
 if(y<2000||month<1||month>12||day<1||day>new Date(Date.UTC(y,month,0)).getUTCDate()||+m[4]>23||+m[5]>59||+m[6]>59)return null;
 const time=Date.parse(value+(m[7]?'':'Z'));return Number.isFinite(time)?new Date(time).toISOString():null;
}
export function vietnamDay(value:string):string{
 const time=utcTime(value);if(!time)throw new Error('Botcake: ngày tương tác chưa hợp lệ.');
 return new Date(Date.parse(time)+7*3600000).toISOString().slice(0,10);
}
