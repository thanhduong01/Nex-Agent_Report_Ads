# Nút dưới báo cáo Telegram

Mở **Yêu cầu bot → Nút dưới báo cáo**. Menu mặc định bật cho các báo cáo mới. Chọn 1–3 nút mỗi hàng, đổi tên/emoji, thêm hoặc xóa nút, dùng ↑/↓ để sắp xếp, chọn “Chiếm cả hàng” cho nút dài và bấm **Lưu menu Telegram**.

Các hành động: cập nhật đúng nhóm/kỳ đang xem, chọn hôm nay/hôm qua/7 ngày/tháng, đổi nhóm giữ nguyên kỳ, campaign, sản phẩm, đối soát, nhận định, yêu cầu đã lưu, mở web hoặc lịch gửi, liên kết HTTPS riêng. Nút POS chỉ xuất hiện với nhóm dùng Meta + Pancake; campaign cần nguồn Meta. Chọn nhóm xem thử ở bên phải để xem đúng bố cục theo nguồn.

Với “Chạy yêu cầu đã lưu”, chọn yêu cầu, nhóm đang xem hoặc nhóm cố định, và kỳ đang xem/ngày theo yêu cầu/ngày đặt trước. Nếu yêu cầu khóa ngày, chỉ được dùng ngày theo cấu hình của yêu cầu. Menu không mở rộng phạm vi nhóm đã cấp cho yêu cầu.

Menu mới áp dụng cho báo cáo theo lệnh, lịch tự động và gửi thử. Tin nhắn đã gửi giữ menu cũ; bấm lấy báo cáo mới để nhận nút vừa sửa. Callback có hiệu lực 7 ngày, chỉ chủ chat riêng được dùng. Khi sửa/tắt yêu cầu hoặc hành động, nút cũ hướng dẫn lấy báo cáo mới. “Nhập ngày khác” hướng dẫn cú pháp lệnh đang có; một ngày dùng hai ngày giống nhau để nhận đúng nhóm có mã bắt đầu bằng số.

Đóng web không ảnh hưởng bot. Lịch vẫn được quản lý trên web và thực thi qua GitHub Actions. Đăng ký webhook bao gồm message và callback_query; scheduler tự cập nhật kết nối, hoặc dùng nút “Kết nối & cập nhật menu lệnh” trong Kết nối & lịch.

Không thay đổi công thức, cách ghép đơn, lệnh cũ hoặc lịch cũ. Nhóm chỉ tạm dừng lịch vẫn có thể xem bằng nút/lệnh. Nếu kho lưu nút tạm lỗi, báo cáo vẫn gửi nội dung như trước. Báo cáo gửi được một phần không tự gửi lại hoặc ghép hai lần đọc dữ liệu; bot hướng dẫn lấy một bản mới.

## Kiểm thử

- `npm test`: kiểm thử logic cũ + menu/schema/chữ ký/quyền/date/group/request/race/DOM.
- `npm run typecheck` và `npm run build`.
- `npm run qa:telegram-http` sau build: khởi động bản compiled trong thư mục tạm với thông tin giả, chặn mọi API bên ngoài; kiểm tra API đăng nhập/lưu, Meta report, gửi thử, webhook thật của Eve, callback trùng/sai chủ/sai secret, chọn ngày, /help và lịch gửi. Không gửi Telegram thật.

Giới hạn xác minh: test DOM không thay cho quan sát bố cục trên trình duyệt thật hoặc bấm nút trong ứng dụng Telegram thật.
