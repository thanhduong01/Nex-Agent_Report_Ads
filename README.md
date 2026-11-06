# Nex Report Ads Performance

Agent đọc báo cáo quảng cáo từ Google Sheets theo tháng và gửi kết quả qua Telegram theo lệnh hoặc lịch riêng từng nhóm (giờ Việt Nam).

## Meta Ads, mẫu báo cáo và chỉ số tự tính

1. Vào **Nguồn dữ liệu**, tạo kết nối Meta bằng System User token có quyền ads_read vào tài khoản quảng cáo doanh nghiệp. Token được lưu trong kho riêng tư phía máy chủ; không nhập token vào chat hoặc commit vào GitHub.
2. Vào **Mẫu & chỉ số → Mẫu báo cáo**, chọn nhóm, nguồn **Sheets / Meta / Kết hợp**, tài khoản và các campaign. Một mẫu dùng một tài khoản để giữ đúng tiền tệ và múi giờ. Với nguồn kết hợp, chọn đúng sản phẩm Sheets để ghép SĐT một lần cho cả phạm vi.
3. Vào **Chỉ số tự tính**, đặt mã, tên, công thức, đơn vị và phạm vi hiển thị. Nhập dữ liệu thử và bấm **Tính thử công thức** trước khi lưu. Chỉ số đã lưu có thể được chọn và sắp xếp trong mọi mẫu.
4. Chạy thử mẫu với khoảng ngày cụ thể; kiểm tra chỉ số, nội dung và độ dài bản tin. Lưu mẫu, rồi gắn nhóm vào yêu cầu bot hoặc bật lịch gửi trong **Kết nối & lịch**.

Ví dụ công thức:

    chi_phi / tin_nhan
    so_dien_thoai / tin_nhan_co_sdt * 100
    chi_phi + thue + phi_dich_vu
    IF(tin_nhan > 0, ROUND(chi_phi / tin_nhan, 2), NULL)

thue và phi_dich_vu là biến cố định do bạn nhập, không phải mức thuế/phí hệ thống tự suy đoán. Biến riêng của mẫu ghi đè biến chung cùng tên. Các biến gốc khác gồm chi_phi_co_sdt, hien_thi, nhap_lien_ket, lead, don_hang, doanh_thu; chỉ số không có trong nguồn sẽ không tính được.

Công thức hỗ trợ phép tính số học, so sánh, IF, ROUND, ABS, MIN, MAX, SUM, COALESCE, NULL và tham chiếu chỉ số khác. Không chạy JavaScript. Tối đa 25 chỉ số riêng, 512 ký tự/công thức, 30 chỉ số/mẫu, 93 ngày/lần lấy. Tỷ lệ tổng kỳ được tính lại từ tổng đầu vào; chia cho 0 và thiếu dữ liệu không biến thành số 0.

Nội dung tin nhắn có thể dùng {{ten_nhom}}, {{ky_bao_cao}}, {{chi_so}}, {{chi_tiet}}, {{so_sanh}}, {{nguon}}, {{thoi_diem_doc}} hoặc mã chỉ số đã chọn. Các bí danh {{chi_phi}}, {{tin_nhan}}, {{so_dien_thoai}} dùng được khi chọn chỉ số tương ứng.

Lệnh hỗ trợ ngày hoặc khoảng ngày, ví dụ /baocao 01/11/2026 06/11/2026. Ngày/kỳ mặc định của lệnh có thể khác lịch tự động. Lịch GitHub Actions dùng cấu hình đã lưu ở lần kiểm tra kế tiếp, không cần sửa workflow cho mỗi lịch.

Meta không cung cấp SĐT mà nhân viên thu trong hội thoại qua Insights; số này lấy từ Sheets. Khách Sạn không theo dõi SĐT. Khi đối soát Meta, dùng đúng action type của kết quả nhắn tin, attribution, tiền tệ và múi giờ tài khoản. Chi phí Meta được tách khỏi phần thuế/phí nhập thêm.

**Lịch sử** phân biệt bản xem trước, báo cáo đã chuẩn bị, lần gửi Telegram và lỗi. Khi Meta lỗi quyền hoặc token, vào **Nguồn dữ liệu** để kiểm tra lại kết nối. Dữ liệu thật từ Meta chỉ hoạt động sau khi người quản trị lưu token hợp lệ.

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

Mở [Nex Report Ads Performance](http://127.0.0.1:4317), vào **Kết nối** để đăng ký file Sheets và ghép nối bot Telegram. Nhóm và nguồn trên máy được lưu trong `.data/report-groups.json`, thông tin đăng nhập trong `.env.local`.

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
