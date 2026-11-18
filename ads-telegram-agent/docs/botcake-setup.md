# Botcake: kết nối và báo cáo SĐT

## Kết nối
1. Mở **Nguồn dữ liệu → Kết nối Botcake**, bấm **Kiểm tra kho SĐT** để xác nhận database và tạo bảng riêng. Nhập tên kết nối, Page ID và API token của Page.
2. Chọn **Hồ sơ / Custom Fields / cả hai**. Với Custom Fields, tải danh sách và chọn tối đa 5 trường lưu SĐT.
3. Bấm **Kiểm tra & lưu kết nối**, chọn Page ở khung đồng bộ rồi bấm **Đồng bộ tiếp**.
4. Lượt đầu tạo dữ liệu nền. Chờ trạng thái hoàn tất trước khi dùng số liệu mới. Lượt dài giữ cursor và tiếp tục qua nút đồng bộ hoặc GitHub Actions hiện có.
5. Vào **Mẫu & chỉ số**, chọn nguồn có Meta, bật **Bổ sung SĐT mới từ Botcake**, chọn Page và các chỉ số cần dùng. Lưu mẫu; web, lệnh/nút Telegram và lịch gửi dùng cùng cấu hình.

Token chỉ nhập tại website được bảo vệ; không gửi vào chat, repository hoặc GitHub Secrets. Dùng lại token đã lưu bằng cách để trống ô token. Đổi token hoặc gỡ/kết nối lại không xóa lịch sử chống trùng.

## Biến cho công thức và tin nhắn
Các biến số dùng trực tiếp trong công thức; chọn chỉ số tương ứng trong mẫu để chèn placeholder vào tin nhắn.

| Biến | Ý nghĩa |
|---|---|
| `BOTCAKE_SDT_MOI` | SĐT mới ghi nhận của các Page trong kỳ, không gồm nền |
| `BOTCAKE_SDT_KHOP_CAMP` | SĐT mới có ID quảng cáo khớp campaign đã chọn |
| `BOTCAKE_SDT_CHUA_GAN` | SĐT mới chưa gán vào campaign của mẫu; có thể gồm nguồn ngoài phạm vi |
| `BOTCAKE_TONG_SDT` | Tổng đã ghi nhận đến hết kỳ và mốc đồng bộ, gồm nền |
| `BOTCAKE_CP_SDT_MOI` | Chi phí Meta / SĐT mới khớp campaign; không tính khi thiếu dữ liệu hoặc chia 0 |

Biến văn bản: `{{BOTCAKE_TEN_PAGE}}`, `{{BOTCAKE_DONG_BO_LUC}}`, `{{BOTCAKE_TRANG_THAI}}`, `{{BOTCAKE_CHI_TIET_CAMP}}`.

Ví dụ công thức riêng: `(chi_phi / BOTCAKE_SDT_KHOP_CAMP) + phi_dich_vu` với `phi_dich_vu` được khai báo trong biến cố định. Hỗ trợ `+ - * /`, ngoặc và các hàm hiện có; không thực thi JavaScript. Đặt công thức có dữ liệu Page tổng ở phạm vi **Chỉ tổng kỳ**.

Ví dụ nội dung sau khi chọn hai chỉ số đầu:

```text
📊 {{ten_nhom}} · {{ky_bao_cao}}
SĐT mới theo Page: {{BOTCAKE_SDT_MOI}}
Khớp campaign: {{BOTCAKE_SDT_KHOP_CAMP}}
{{BOTCAKE_CHI_TIET_CAMP}}
{{BOTCAKE_TRANG_THAI}}
Đồng bộ: {{BOTCAKE_DONG_BO_LUC}}
```

## Cách ghi nhận và giới hạn nguồn
- Chuẩn hóa `090…`, `8490…`, `+8490…` về một số. Số Việt Nam được mặc định +84; số quốc tế cần mã quốc gia.
- Khóa chống trùng là **Page ID + SĐT**, không phụ thuộc ngày, PSID, campaign, nhóm báo cáo, token hay tháng. Cùng số trên Page khác được tính riêng.
- Ngày ghi nhận lấy từ `last_interactive_at` UTC đổi sang giờ Việt Nam tại lần chấp nhận đầu. Ngày và `ad_id` lúc đó được giữ cố định; khách quay lại không cộng lại. `ad_id` của API là quảng cáo gần nhất, không chứng minh attribution first-touch.
- Chỉ đọc SĐT hồ sơ/trường đã chọn; không trích tin nhắn. API danh sách khách gồm khách subscribed; số liệu là **mới ghi nhận trong hệ thống**, không khẳng định khách mới tuyệt đối của doanh nghiệp. Không phục dựng lịch sử trước mốc theo dõi.
- Thêm/đổi trường sẽ nhập các số chưa biết làm nền để tránh tăng giả. Các số mới đã ghi nhận trước đó được giữ nguyên.
- Thiếu PSID/ngày hợp lệ được giữ chờ. Lượt quét chưa xong không tăng mốc hoàn tất. Ngày ngoài độ phủ hoặc dữ liệu quá 45 phút hiện chưa đủ dữ liệu, không đổi thành 0.
- GitHub Actions có thể chậm theo hàng đợi; lịch 5 phút không phải cam kết cập nhật đúng từng phút.
- Sổ tại website luôn che SĐT. Database dùng schema riêng, khóa HMAC riêng bền vững và mã hóa số; không đổi mật khẩu dashboard/token để thay khóa dữ liệu.

## Kiểm chứng
Các test dùng fixture và PostgreSQL qua PGlite, không dùng token/khách thật. Bộ QA có kiểm tra khóa chống trùng, baseline, UTC, lease, cursor, lỗi API, dropdown, công thức, placeholder, auth/CSRF, Meta/POS/Telegram hiện có và HTTP của bản Eve đã build.

Để nghiệm thu dữ liệu thật: kết nối token của chủ Page qua website, hoàn tất nền, đối chiếu vài số đã che; sau đó kiểm tra một số mới và khách cũ quay lại hôm sau. Việc này cần nguồn thật đã được chủ tài khoản kết nối.
