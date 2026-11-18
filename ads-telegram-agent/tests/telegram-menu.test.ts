import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getRegistry} from '../agent/lib/groups.ts';
import {defaultMenu,menuSchema,layoutButtons} from '../agent/lib/telegram-menu-config.ts';
import {validateMenu,menuAction} from '../agent/lib/telegram-menu-actions.ts';
import {saveMenuContext,readMenuCallback} from '../agent/lib/telegram-menu-context.ts';

import {menuFixture} from './telegram-menu-fixture.ts';
test('menu schema validates HTTPS links, references, unique IDs and independent revision saves',async t=>{
 await menuFixture(t);const old=await getRegistry();
 assert.equal(defaultMenu().enabled,true);
 const menu=defaultMenu();menu.buttons.push({id:'saved',label:'Báo cáo riêng',enabled:true,action:'request',requestId:'today',groupMode:'fixed',groupId:'default',dateMode:'current',fullRow:false});
 assert.equal(validateMenu(menu,old).buttons.at(-1)?.requestId,'today');
 for(const change of [{url:'javascript:alert(1)'},{url:'https://user:password@example.test'},{url:'http://example.test'}])assert.equal(menuSchema.safeParse({...menu,buttons:[{...menu.buttons.at(-1),action:'url',...change}]}).success,false);
 assert.throws(()=>validateMenu({...menu,buttons:[{...menu.buttons.at(-1),requestId:'missing'}]},old));
 assert.equal(menuSchema.safeParse({...menu,buttons:[menu.buttons[0],menu.buttons[0]]}).success,false);
 await menuAction({menu,revision:0});const saved=await getRegistry();
 assert.deepEqual(saved.groups,old.groups);assert.deepEqual(saved.requests,old.requests);assert.deepEqual(saved.telegramMenu,menuSchema.parse(menu));
 await assert.rejects(menuAction({menu:{...menu,enabled:false},revision:0}),/đã thay đổi/);
 assert.equal((await getRegistry()).telegramMenu?.enabled,true);
});
test('keyboard layout respects full-width rows and Telegram limits',()=>{
 const buttons=[{text:'one'},{text:'two'},{text:'three',fullRow:true},{text:'four'}];
 assert.deepEqual(layoutButtons(buttons,2).map(row=>row.map(b=>b.text)),[['one','two'],['three'],['four']]);
 assert.equal(layoutButtons(buttons,1).length,4);
});
test('signed opaque callbacks preserve explicit ranges, reject tampering, owner changes and expiry',async t=>{
 await menuFixture(t);const now=Date.parse('2026-11-18T02:00:00Z');
 const context={groupId:'default',from:'2026-11-01',to:'2026-11-14',requestId:'today'};
 const tokens=await saveMenuContext(context,[{kind:'button',buttonId:'refresh',fingerprint:'v1'}],now);
 assert(Buffer.byteLength(tokens[0])<=64);assert(!tokens[0].includes('default'));
 assert.deepEqual((await readMenuCallback(tokens[0],now+1))?.context,context);
 assert.equal(await readMenuCallback(tokens[0].slice(0,-1)+'!',now),null);
 assert.equal(await readMenuCallback(tokens[0],now+8*86400000),null);
 process.env.TELEGRAM_CHAT_ID='124';assert.equal(await readMenuCallback(tokens[0],now),null);
 process.env.TELEGRAM_CHAT_ID='123';process.env.TELEGRAM_BOT_TOKEN='123456:ZYXWVUTSRQPONMLKJIHGFEDCBA_abcdefghi';assert.equal(await readMenuCallback(tokens[0],now),null);
});
