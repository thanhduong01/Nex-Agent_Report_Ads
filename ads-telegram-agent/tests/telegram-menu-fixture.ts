import type test from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function menuFixture(t:test.TestContext){
 const dir=await mkdtemp(join(tmpdir(),'telegram-menu-'));
 const values={REPORT_CONFIG_PATH:join(dir,'groups.json'),PRIVATE_CONFIG_DIR:dir,TELEGRAM_MENU_DIR:join(dir,'menus'),REPORT_SOURCES_JSON:'{}',TELEGRAM_CHAT_ID:'123',TELEGRAM_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghi',VERCEL:undefined,BLOB_READ_WRITE_TOKEN:undefined,BLOB_STORE_ID:undefined};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 for(const [k,v] of Object.entries(values))if(v===undefined)delete process.env[k];else process.env[k]=v;
 await writeFile(values.REPORT_CONFIG_PATH,JSON.stringify({version:1,revision:0,groups:[{id:'default',name:'Original',enabled:false,sources:{'2026-11':{spreadsheetId:'example'}},schedule:{enabled:false,time:'09:00',days:[1],reportDay:'yesterday'}}]}));
 t.after(async()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;await rm(dir,{recursive:true,force:true});});
 return dir;
}
