// Uppercase operands are separate from existing user-authored lowercase metric IDs.
export const botcakeCatalog=[
 {id:'BOTCAKE_SDT_MOI',name:'SĐT mới ghi nhận theo Page trong kỳ',unit:'number',decimals:0,scope:'total'},
 {id:'BOTCAKE_SDT_KHOP_CAMP',name:'SĐT mới khớp campaign của mẫu',unit:'number',decimals:0,scope:'both'},
 {id:'BOTCAKE_SDT_CHUA_GAN',name:'SĐT mới chưa gán vào campaign của mẫu',unit:'number',decimals:0,scope:'total'},
 {id:'BOTCAKE_TONG_SDT',name:'Tổng SĐT đã ghi nhận theo Page (gồm nền)',unit:'number',decimals:0,scope:'total'},
 {id:'BOTCAKE_CP_SDT_MOI',name:'Chi phí Meta/SĐT mới khớp campaign',unit:'currency',decimals:0,scope:'both'},
] as const;
export const botcakeVariables=Object.fromEntries(botcakeCatalog.map(m=>[m.id,'Botcake · '+m.name]));
export const botcakeMetrics=botcakeCatalog.map(m=>({...m,id:'API_'+m.id,name:'Botcake · '+m.name,formula:m.id,provider:'botcake' as const}));
export const botcakeAliases=Object.fromEntries(botcakeCatalog.map(m=>[m.id,'API_'+m.id]));
export const botcakeTextVariables={BOTCAKE_TEN_PAGE:'Tên các Page đã chọn',BOTCAKE_DONG_BO_LUC:'Lần hoàn tất đồng bộ (giờ Việt Nam)',BOTCAKE_TRANG_THAI:'Trạng thái và phạm vi dữ liệu',BOTCAKE_CHI_TIET_CAMP:'SĐT mới và chi phí theo campaign'};
export const emptyBotcakeMetrics=()=>Object.fromEntries(botcakeCatalog.map(m=>[m.id,null])) as Record<string,number|null>;
