import {appendFile} from 'node:fs/promises';
const actual=globalThis.fetch,rows=new Map();let seq=1000;
globalThis.fetch=async function(input,options={}){
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 const payload=options.body?JSON.parse(options.body):{};
 if(u.hostname==='api.telegram.org'){
  const method=u.pathname.split('/').pop();
  if(method==='sendMessage')await appendFile(process.env.QA_EVENTS,JSON.stringify({method,...payload})+'\n');
  return Response.json({ok:true,result:method==='sendMessage'?{message_id:++seq,chat:{id:123,type:'private'}}:method==='getMe'?{id:456,username:'QA_Bot',is_bot:true}:method==='getChat'?{id:123,type:'private'}:method==='getWebhookInfo'?{url:'https://reports.example.test/eve/v1/telegram',pending_update_count:0}:true});
 }
 if(u.hostname==='qa-redis.example.test'){
  const old=rows.get(payload[3]);
  if(payload[0]!=='EVAL')throw new Error('Unexpected Redis operation');
  if(payload[1].includes("r.state~='failed'")){
   if(old&&old.state!=='failed')return Response.json({result:0});rows.set(payload[3],JSON.parse(payload[4]));return Response.json({result:1});
  }
  if(!old)return Response.json({result:0});old.state=payload[4];return Response.json({result:1});
 }
 if(u.hostname==='botcake.io'){
  if(u.pathname.endsWith('/customer'))return Response.json({success:true,data:[]},{headers:{'x-next-after':''}});
  if(u.pathname.endsWith('/custom_fields'))return Response.json({success:true,data:u.searchParams.get('page')==='0'?[{id:4,name:'Stored phone',type:1}]:[]});
  throw new Error('Unexpected Botcake QA endpoint');
 }
 if(u.hostname==='graph.facebook.com'&&u.pathname.endsWith('/campaigns'))return Response.json({data:[{id:'10',name:'QA campaign',effective_status:'ACTIVE'}]});
 if(u.hostname==='graph.facebook.com')return Response.json({data:[{campaign_id:'10',campaign_name:'QA campaign',spend:'120000',impressions:'1000',inline_link_clicks:'20',actions:[{action_type:'onsite_conversion.messaging_conversation_started_7d',value:'12'}],action_values:[]}]});
 if(['127.0.0.1','localhost'].includes(u.hostname))return actual(input,options);
 throw new Error('QA blocked external request');
};
