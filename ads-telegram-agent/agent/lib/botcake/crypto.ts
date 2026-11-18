import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {readPrivate,updatePrivate} from '../private-store.ts';
import {GroupError} from '../groups.ts';
import {normalizePhone} from './phones.ts';
export class PhoneVault{
 private readonly key:Buffer;readonly id:string;
 constructor(secret:string){if(!/^[a-f0-9]{64}$/.test(secret))throw new GroupError('Botcake: khóa dữ liệu riêng tư chưa hợp lệ.',503);this.key=createHmac('sha256',Buffer.from(secret,'hex')).update('nex-botcake/encryption/v1').digest();this.id=createHmac('sha256',this.key).update('key-id').digest('hex').slice(0,24);}
 hash(phone:string){const canonical=normalizePhone(phone);if(!canonical)throw new GroupError('Botcake: SĐT chưa hợp lệ.');return createHmac('sha256',this.key).update('phone/v1\0'+canonical).digest('hex');}
 seal(phone:string){const canonical=normalizePhone(phone);if(!canonical)throw new GroupError('Botcake: SĐT chưa hợp lệ.');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const body=Buffer.concat([cipher.update(canonical,'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),body.toString('base64url')].join('.');}
 mask(value:string){try{const [version,iv,tag,body]=value.split('.');if(version!=='v1')throw new Error();const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(iv,'base64url'));cipher.setAuthTag(Buffer.from(tag,'base64url'));const phone=Buffer.concat([cipher.update(Buffer.from(body,'base64url')),cipher.final()]).toString('utf8');if(!normalizePhone(phone))throw new Error();return phone.slice(0,3)+' ••• '+phone.slice(-4);}catch{throw new GroupError('Botcake: không đọc được SĐT bằng khóa dữ liệu hiện tại. Khôi phục khóa riêng tư; không tạo lại lịch sử.',503);}}
}
export async function botcakeVault(){
 const current=await readPrivate<{key:string|null}>('botcake-data-key',{key:null});
 if(current.key)return new PhoneVault(current.key);
 const saved=await updatePrivate<{key:string|null}>('botcake-data-key',{key:null},draft=>{if(!draft.key)draft.key=randomBytes(32).toString('hex');});
 return new PhoneVault(saved.key!);
}
