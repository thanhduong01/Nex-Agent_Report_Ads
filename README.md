# Nex-Agent Report Ads · Trạm Ads

Agent đọc báo cáo quảng cáo từ Google Sheets theo tháng và gửi kết quả qua Telegram theo lệnh hoặc lịch riêng từng nhóm (giờ Việt Nam).

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

Mở [Trạm Ads](http://127.0.0.1:4317), vào **Kết nối** để đăng ký file Sheets và ghép nối bot Telegram. Nhóm và nguồn trên máy được lưu trong `.data/report-groups.json`, thông tin đăng nhập trong `.env.local`.

## Gửi tự động

Lịch gửi dùng múi giờ `Asia/Ho_Chi_Minh`. Để chạy khi máy tính tắt, triển khai agent lên Vercel và cấu hình Telegram, nguồn Google Sheets cùng Vercel Blob riêng tư lưu cấu hình và lịch sử gửi. Trong Kết nối, chọn nhóm và cấu hình giờ, ngày trong tuần, hôm nay/hôm qua, rồi bật lịch. GitHub Actions kiểm tra mỗi 5 phút và tự áp dụng lịch vừa lưu trên web, dùng được với Vercel Free. Giờ gửi có thể trễ khi GitHub bận. Không cần PAT hay token Telegram trong GitHub Secrets.

Hướng dẫn kết nối, quy tắc tính số liệu, kiểm tra và triển khai nằm trong [README của agent](ads-telegram-agent/README.md).

## Deploy web lên Vercel

Import repository vào Vercel và dùng Node.js 24. Để **Root Directory** ở gốc repository hoặc chọn `ads-telegram-agent`. Cả hai vị trí đều có `vercel.json` cấu hình build và giao diện web.

Trong **Settings → Environment Variables**, thêm `DASHBOARD_PASSWORD` là mật khẩu bạn muốn dùng (không để trống) để đăng nhập web. Sau đó kết nối một Vercel Blob store **private** vào project để lưu các nhóm. Trên web, vào **Kết nối → Nhóm báo cáo & nguồn dữ liệu** để thêm nhóm, file, tháng và chọn các tab/cột. Mỗi lần lưu có hiệu lực ngay. `REPORT_SOURCES_JSON` được hỗ trợ để nhập cấu hình cũ lần đầu.

Để gửi Telegram, thêm `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`. Blob đã kết nối cũng lưu lịch sử gửi; Redis là tùy chọn. Sau deploy, bấm **Kết nối lệnh Telegram** trên web. Gõ `/baocao` để nhận số liệu hôm nay, `/baocao 02/11/2026 Thượng Hải` để chọn ngày và nhóm, `/homqua`, `/nhom` hoặc `/lich` để xem thêm. Chỉ chat riêng đã cấu hình được dùng lệnh.

Redeploy sau khi đổi biến môi trường. Nhóm và nguồn được quản lý trực tiếp trong bảng điều khiển. Thông tin bot trên local lưu trong `.env.local`.

## Kiểm tra

Chạy trong thư mục `ads-telegram-agent`.

```bash
npm test
npm run typecheck
npm run build
```

## Cấu hình lệnh và câu yêu cầu

Vào **Yêu cầu bot** để tạo/sửa/xóa lệnh như `/thuonghai`, đặt câu như “báo cáo Thượng Hải”, chọn nhóm, ngày mặc định và kiểu phản hồi. Dùng **Chạy thử** để xem số liệu thật ngay trên web trước khi lưu. Câu được nhận diện nguyên câu, không phân biệt dấu tiếng Việt hoặc hoa thường. Mỗi lần lưu áp dụng ngay, không cần sửa biến môi trường. Lịch tự gửi được chỉnh riêng trong **Kết nối & lịch gửi**.
