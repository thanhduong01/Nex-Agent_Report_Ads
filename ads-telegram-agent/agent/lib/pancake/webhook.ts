import {timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {pancakeConnection} from "./connections.ts";
import {salesStore} from "./store.ts";
import {posId} from "./types.ts";

const reference=z.object({id:posId,shop_id:posId});
export async function pancakeWebhook(request:Request,deps={connection:pancakeConnection,store:salesStore}){
  const json=(status:number,body:object)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  if(request.method!=="POST")return json(405,{ok:false});
  const id=new URL(request.url).searchParams.get("connection")||"";
  if(!/^[a-z0-9-]{1,64}$/.test(id))return json(401,{ok:false});
  const secret=request.headers.get("x-nex-webhook-secret")||"";
  if(!/^[a-f0-9]{64}$/.test(secret))return json(401,{ok:false});
  let connection;try{connection=await deps.connection(id);}catch{return json(401,{ok:false});}
  if(!timingSafeEqual(Buffer.from(secret),Buffer.from(connection.secret)))return json(401,{ok:false});
  if(Number(request.headers.get("content-length"))>256000)return json(413,{ok:false});
  try{
    const reader=request.body?.getReader();if(!reader)return json(400,{ok:false});
    let text="",size=0;const decoder=new TextDecoder();
    while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>256000){await reader.cancel();return json(413,{ok:false});}text+=decoder.decode(p.value,{stream:true});}
    text+=decoder.decode();let body;
    try{body=JSON.parse(text);}catch{return json(400,{ok:false});}
    // Accept known order envelopes, persisting only a shop/order reference; never customer payloads.
    const parsed=reference.safeParse(body?.data?.order||body?.data?.record||body?.data||body?.order||body);
    if(!parsed.success)return json(400,{ok:false});
    const order=parsed.data;if(!connection.shops.some(s=>s.id===order.shop_id))return json(403,{ok:false});
    await deps.store().event(id,order.shop_id,order.id);
    return json(202,{ok:true});
  }catch{console.warn("Pancake webhook not persisted",{connectionId:id});return json(503,{ok:false});}
}
