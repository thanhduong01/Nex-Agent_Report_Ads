# Nex-Agent Report Ads · Trạm Ads

Agent đọc báo cáo quảng cáo từ Google Sheets theo tháng và gửi kết quả ngày hôm trước qua Telegram lúc **09:00 giờ Việt Nam**.

Bảng điều khiển tiếng Việt hỗ trợ chọn ngày, xem chi phí, tin nhắn, SĐT theo sản phẩm, xem trước bản tin, ghép nối Telegram và thêm file Sheets theo tháng.

## Chạy trên máy

Yêu cầu Node.js 24.

```bash
git clone https://github.com/thanhduong01/Nex-Agent_Report_Ads.git
cd Nex-Agent_Report_Ads/ads-telegram-agent
npm ci
cp .env.example .env.local
npm run ui
```

Mở [Trạm Ads](http://127.0.0.1:4317), vào **Kết nối** để đăng ký file Sheets và ghép nối bot Telegram. Cấu hình nguồn và thông tin đăng nhập được lưu trong `.env.local` riêng của môi trường chạy.

## Gửi tự động

Lịch gửi dùng múi giờ `Asia/Ho_Chi_Minh`. Để chạy khi máy tính tắt, triển khai agent lên Vercel và cấu hình Telegram, nguồn Google Sheets cùng Redis lưu lịch sử gửi.

Hướng dẫn kết nối, quy tắc tính số liệu, kiểm tra và triển khai nằm trong [README của agent](ads-telegram-agent/README.md).

## Deploy web lên Vercel

Import repository vào Vercel và dùng Node.js 24. Để **Root Directory** ở gốc repository hoặc chọn `ads-telegram-agent`. Cả hai vị trí đều có `vercel.json` cấu hình build và giao diện web.

Trong **Settings → Environment Variables**, thêm `DASHBOARD_PASSWORD` gồm ít nhất 16 ký tự để đăng nhập web và `REPORT_SOURCES_JSON` chứa danh sách nguồn theo tháng. Dùng giá trị nguồn đã lưu trong `.env.local` trên máy.

Để gửi Telegram, thêm `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN`. Bật `SEND_REPORTS=true` sau khi cấu hình nơi nhận và gửi thử thành công.

Redeploy sau khi đổi biến môi trường. Bản web đọc cấu hình từ Vercel. Bảng điều khiển local hỗ trợ ghép bot và lưu cấu hình vào `.env.local`.

## Kiểm tra

Chạy trong thư mục `ads-telegram-agent`.

```bash
npm test
npm run typecheck
npm run build
```
