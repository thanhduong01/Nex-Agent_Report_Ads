// Whitelisted reporting fields, verified against Meta's AdsInsights SDK and Pancake Order reference.
// Contact details, addresses and conversation contents are deliberately outside the reporting model.
export type SourceField={id:string;name:string;provider:'meta'|'pancake';unit:'number'|'currency'|'percent';field?:string;action?:string;money?:boolean};
const scalar=(field:string,name:string,unit:SourceField['unit']='number'):SourceField=>({id:'meta_'+field,name,provider:'meta',unit,field});
const action=(id:string,name:string,field:string,type:string,unit:SourceField['unit']='number'):SourceField=>({id:'meta_'+id,name,provider:'meta',unit,field,action:type});
export const metaFields:SourceField[]=[
 scalar('reach','Tiếp cận'),scalar('frequency','Tần suất'),scalar('clicks','Tất cả lượt nhấp'),scalar('unique_clicks','Người nhấp duy nhất'),
 scalar('cpc','CPC tất cả lượt nhấp','currency'),scalar('cpp','Chi phí / 1.000 người tiếp cận','currency'),scalar('ctr','CTR tất cả lượt nhấp','percent'),
 scalar('unique_ctr','CTR duy nhất','percent'),scalar('inline_link_click_ctr','CTR liên kết API','percent'),scalar('unique_inline_link_clicks','Người nhấp liên kết duy nhất'),
 scalar('unique_inline_link_click_ctr','CTR liên kết duy nhất','percent'),scalar('cost_per_unique_click','Chi phí / người nhấp','currency'),
 scalar('cost_per_inline_link_click','Chi phí / nhấp liên kết','currency'),scalar('cost_per_unique_inline_link_click','Chi phí / người nhấp liên kết','currency'),
 scalar('inline_post_engagement','Tương tác bài viết'),scalar('cost_per_inline_post_engagement','Chi phí / tương tác bài viết','currency'),
 scalar('social_spend','Chi phí xã hội','currency'),scalar('full_view_impressions','Hiển thị xem đầy đủ'),scalar('full_view_reach','Tiếp cận xem đầy đủ'),
 scalar('estimated_ad_recallers','Người nhớ quảng cáo ước tính'),scalar('estimated_ad_recall_rate','Tỷ lệ nhớ quảng cáo ước tính','percent'),
 scalar('instant_experience_clicks_to_open','Lượt mở trải nghiệm tức thì'),scalar('instant_experience_clicks_to_start','Lượt bắt đầu trải nghiệm tức thì'),
 scalar('instagram_profile_visits','Lượt thăm hồ sơ Instagram'),scalar('instagram_profile_follow','Lượt theo dõi Instagram'),
 action('outbound_clicks','Nhấp ra ngoài','outbound_clicks','outbound_click'),action('unique_outbound_clicks','Người nhấp ra ngoài duy nhất','unique_outbound_clicks','outbound_click'),
 action('landing_page_views','Lượt xem trang đích','actions','landing_page_view'),action('add_to_cart','Thêm vào giỏ','actions','add_to_cart'),
 action('checkout','Bắt đầu thanh toán','actions','initiate_checkout'),action('content_views','Xem nội dung','actions','view_content'),
 action('post_reactions','Cảm xúc bài viết','actions','post_reaction'),action('comments','Bình luận','actions','comment'),action('shares','Chia sẻ bài viết','actions','post'),
 action('page_engagement','Tương tác trang','actions','page_engagement'),action('page_likes','Lượt thích trang','actions','like'),
 action('new_contacts','Liên hệ nhắn tin mới','actions','onsite_conversion.messaging_first_reply'),action('message_blocks','Chặn tin nhắn','actions','onsite_conversion.messaging_block'),
 action('add_to_cart_value','Giá trị thêm vào giỏ','action_values','add_to_cart','currency'),action('checkout_value','Giá trị bắt đầu thanh toán','action_values','initiate_checkout','currency'),
 ...[['plays','Lượt phát video','video_play_actions'],['2s','Lượt xem video liên tục 2 giây','video_continuous_2_sec_watched_actions'],
 ['thruplay','ThruPlay','video_thruplay_watched_actions'],['15s','Lượt xem video 15 giây','video_15_sec_watched_actions'],
 ['30s','Lượt xem video 30 giây','video_30_sec_watched_actions'],['p25','Lượt xem 25% video','video_p25_watched_actions'],
 ['p50','Lượt xem 50% video','video_p50_watched_actions'],['p75','Lượt xem 75% video','video_p75_watched_actions'],
 ['p95','Lượt xem 95% video','video_p95_watched_actions'],['p100','Lượt xem hết video','video_p100_watched_actions'],
 ['avg_time','Thời gian xem video trung bình (giây)','video_avg_time_watched_actions']].map(([id,name,field])=>action('video_'+id,name,field,'video_view')),
];
export const posMoneyFields:SourceField[]=[
 ['cod','Tiền COD'],['cash','Tiền mặt ghi trên đơn'],['shipping_fee','Phí vận chuyển'],['partner_fee','Phí đối tác vận chuyển'],
 ['fee_marketplace','Phí sàn thương mại'],['total_price','Tổng giá trị đơn theo API'],['charged_by_card','Thanh toán thẻ'],
 ['charged_by_qrpay','Thanh toán QR'],['charged_by_vnpay','Thanh toán VNPay'],['charged_by_momo','Thanh toán MoMo'],
 ['charged_by_fundiin','Thanh toán Fundiin'],['charged_by_kredivo','Thanh toán Kredivo'],['money_to_collect','Số tiền cần thu'],
 ['surcharge','Phụ thu'],['discount_by_customer_level','Chiết khấu theo cấp khách'],
 ...[['ads_top_up','Nạp ví quảng cáo sàn'],['affiliate_commission','Hoa hồng affiliate'],['diff_shipping_fee','Chênh lệch vận chuyển'],
 ['marketplace_voucher','Voucher sàn'],['payment_fee','Phí thanh toán'],['platform_commission','Hoa hồng sàn'],
 ['seller_transaction_fee','Phí giao dịch người bán'],['service_fee','Phí dịch vụ'],['sfp_service_fee','Phí dịch vụ SFP']].map(([field,name])=>['advanced_platform_fee.'+field,name]),
].map(([field,name])=>({id:'pos_'+field.replace('advanced_platform_fee.',''),name,provider:'pancake',unit:'currency',field,money:true}));
export const posStatusLabels:Record<string,string>={0:'Mới',1:'Đã xác nhận',2:'Đã gửi',3:'Đã nhận',4:'Đang hoàn',5:'Đã hoàn',6:'Đã hủy',7:'Đã xóa',8:'Đóng gói',9:'Chờ lấy hàng',11:'Chờ hàng',12:'Chờ in',13:'Đã in',15:'Hoàn một phần',16:'Đã thu tiền',17:'Chờ xác nhận',20:'Đã mua'};
export const posFields:SourceField[]=[...posMoneyFields,
 ...[['all_orders','Tất cả đơn trong kỳ'],['delivered_orders','Đơn đã giao / thu tiền'],['cancelled_orders','Đơn hủy'],['returning_orders','Đơn đang hoàn'],['returned_orders','Đơn hoàn toàn bộ'],
 ['partial_return_orders','Đơn hoàn một phần'],['unmatched_orders','Đơn chưa nối campaign'],['returned_units','Sản phẩm đã hoàn'],['gift_units','Sản phẩm tặng'],['discount_total','Chiết khấu ghi trên đơn'],['product_count','Số sản phẩm khác nhau'],['variant_count','Số biến thể khác nhau']].map(([field,name])=>({id:'pos_'+field,name,provider:'pancake' as const,unit:field==='discount_total'?'currency' as const:'number' as const})),
 ...Object.entries(posStatusLabels).map(([code,label])=>({id:'pos_status_'+code,name:'Số đơn trạng thái '+code+' · '+label,provider:'pancake' as const,unit:'number' as const})),
];
export const sourceFields=[...metaFields,...posFields];
export const sourceFieldVariables=Object.fromEntries(sourceFields.map(f=>[f.id.toUpperCase(),(f.provider==='meta'?'Meta · ':'POS · ')+f.name]));
export const sourceFieldMetrics=sourceFields.map(f=>({id:'API_'+f.id.toUpperCase(),name:(f.provider==='meta'?'Meta · ':'POS · ')+f.name,formula:f.id.toUpperCase(),unit:f.unit,decimals:f.unit==='percent'||/frequency|avg_time|cpc|cpp|cost_per/.test(f.id)?2:0,scope:'both' as const,provider:f.provider}));
