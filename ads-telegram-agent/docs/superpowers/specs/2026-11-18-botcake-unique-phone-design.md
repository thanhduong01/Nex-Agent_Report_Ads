# Đề xuất Botcake: SĐT mới không trùng theo Page

Trạng thái: đề xuất triển khai. Đã chốt yêu cầu chống trùng theo từng Page; chưa thay đổi mã chạy ứng dụng.

## Yêu cầu đã chốt

- Chỉ lấy SĐT đã lưu trong hồ sơ Botcake hoặc Custom Field được chọn; bỏ qua nội dung tin nhắn.
- Ngày báo cáo lấy từ `last_interactive_at`, chuyển từ UTC sang Asia/Ho_Chi_Minh.
- Cùng một SĐT hợp lệ trên cùng Page chỉ được ghi nhận mới một lần, xuyên ngày, tháng, campaign, mẫu báo cáo và lần kết nối lại.
- Cùng SĐT ở Page khác được xử lý riêng. Gửi lại/xem lại cùng báo cáo phải giữ kết quả truy vấn theo ngày ghi nhận; việc gửi Telegram không quyết định một SĐT có mới hay không.
- Gắn thêm Botcake vào nguồn Meta hoặc Meta + Pancake POS hiện có. Các cấu hình, lệnh, công thức, lịch và nguồn cũ tiếp tục dùng như trước.

## Căn cứ API

OpenAPI chính thức: https://developers.botcake.io/botcake.yaml
Base URL: https://botcake.io/api/public_api/v1

- GET /pages/{page_id}/customer: danh sách khách đang subscribed, có PSID và SĐT; dùng after/limit, tối đa 100 mỗi lượt, không dựa vào page sâu.
- GET /pages/{page_id}/customer/{psid}/info: phone_number, ad_id gần nhất, ad_ids, last_interactive_at (UTC, có thể null), trạng thái subscribed.
- GET /pages/{page_id}/custom_fields: danh mục trường của Page.
- GET /pages/{page_id}/customer/{psid}/customer_fields hoặc bulk custom_field/{id}/get_customers_field: đọc trường SĐT đã ánh xạ.

Không giả định API có bộ lọc cập nhật theo ngày khi schema chưa xác nhận. Phải quét danh sách theo cursor; chỉ quét khách mới đăng ký sẽ bỏ sót SĐT vừa được bổ sung cho khách cũ. Giới hạn bao phủ: list chỉ gồm khách đang subscribed, thông tin của PSID đã biết vẫn có thể đọc bằng /info; dữ liệu không được API cung cấp không thể dựng thành lịch sử đầy đủ.

## ADR-01: Dùng sổ SĐT trong Supabase

Quyết định: tái sử dụng PostgreSQL/Supabase đã kết nối, thêm bảng riêng tiền tố botcake_ trong schema riêng tư. Tái sử dụng GitHub Actions để chạy từng lô đồng bộ; không yêu cầu Vercel Cron.

Lý do: lọc theo last_interactive_at đơn thuần sẽ đếm lại khách cũ; lưu lịch sử theo tin nhắn Telegram sẽ làm số liệu thay đổi khi xem/gửi lại báo cáo. Khóa unique ở database chặn đồng thời cả lượt đồng bộ trùng và job chạy lại.

Đánh đổi: cần dữ liệu nền ban đầu, lưu lịch sử lâu dài và hiển thị độ mới dữ liệu. Quét API theo lô có độ trễ, không cam kết cập nhật tức thì.

## ADR-02: Quy tắc ghi nhận cố định

Chuẩn hóa SĐT có mã quốc gia (mặc định Việt Nam, cho cấu hình quốc gia); loại khoảng trắng/dấu phân cách, đưa 0xxx và +84xxx về một dạng; dữ liệu không đủ/không hợp lệ giữ riêng. Khóa logic unique: (namespace ứng dụng, page_id, fingerprint của SĐT chuẩn hóa). Khóa không chứa ngày, campaign, report group hoặc connection ID có thể thay đổi.

Lần đầu chấp nhận một SĐT sau giai đoạn khởi tạo:
1. Đọc hồ sơ, kiểm tra SĐT và last_interactive_at hợp lệ.
2. Tạo một bản ghi duy nhất trong giao dịch SQL; ON CONFLICT không tăng số mới.
3. Lưu ngày ghi nhận cố định từ last_interactive_at của hồ sơ lúc đó, thời điểm hệ thống phát hiện, Page/PSID và ad_id tại lúc ghi nhận.
4. Nối ad_id với campaign/account Meta khi có căn cứ. Không có nguồn thì giữ nhóm chưa xác định; không tự chuyển khách cũ sang campaign mới khi ad_id gần nhất thay đổi.
5. Lần sau chỉ cập nhật trạng thái quan sát/lần tương tác gần nhất, không dịch ngày ghi nhận hoặc tạo thêm lead mới cho cùng khóa.

Nhiều PSID dùng cùng SĐT trên cùng Page vẫn chỉ tạo một bản ghi SĐT mới. Nhiều SĐT khác nhau của một người được coi là các SĐT khác nhau; chỉ số “khách” cần định nghĩa riêng nếu bổ sung sau.

Ví dụ: ngày 18 ghi nhận số A trên Page X -> +1; ngày 19 A tương tác lại -> +0; ngày 20 A đến từ campaign khác trên X -> +0; A xuất hiện trên Page Y -> có thể +1 riêng ở Y. Truy vấn lại ngày 18 vẫn giữ A ở ngày ghi nhận 18.

## ADR-03: Khởi tạo và dữ liệu cũ

Mặc định khi kết nối lần đầu: đồng bộ tất cả SĐT API cho phép đọc làm tập có sẵn, không tính chúng là SĐT mới trong ngày bật kết nối. Chỉ bật số liệu mới sau khi khởi tạo hoàn tất cho Page. Lưu mốc bắt đầu theo dõi.

API không có thời điểm thu thập từng SĐT hoặc lịch sử đầy đủ của last_interactive_at. Không cam kết khôi phục chỉ số SĐT mới từng ngày trước khi theo dõi. Nếu có danh sách SĐT từng ghi nhận trước đây, có thể nhập bổ sung tập nền sau; không bắt buộc cho kết nối.

Một số phát hiện lần đầu về sau chưa chứng minh đó là khách mới tuyệt đối của doanh nghiệp: số liệu là “SĐT mới ghi nhận trong hệ thống”, có ghi mốc/độ bao phủ. SĐT thiếu ngày hợp lệ vào hàng chờ kiểm tra, không tự gán ngày đồng bộ. Ngày trước mốc bắt đầu không tự cộng vào hôm nay.

## Thiết kế website

### Nguồn dữ liệu -> Botcake

Thêm khối kết nối cùng hệ thống Meta/POS hiện có:
- Tên kết nối, Page ID, token của Page; có thể quản lý nhiều Page độc lập.
- Nút Kiểm tra & lưu: xác thực quyền, đọc thử danh sách/hồ sơ/trường; trả về bản xem trước đã che SĐT.
- Nguồn SĐT: phone_number, Custom Field được chọn hoặc cả hai; dropdown tải tên/ID trường từ API.
- Quốc gia mặc định; múi giờ Việt Nam; chống trùng theo Page được giải thích ngay tại cấu hình.
- Trạng thái kết nối, khởi tạo/đang đồng bộ/đã đủ/lỗi, lần hoàn tất gần nhất, tiến độ quét và số SĐT nền; nút Đồng bộ ngay.

Token cập nhật không xóa lịch sử. Gỡ rồi nối lại cùng Page tái sử dụng cùng khóa chống trùng. Không có nút xóa/reset lịch sử ngầm.

### Mẫu & chỉ số

Thêm phần tùy chọn “Bổ sung SĐT từ Botcake” cho mẫu Meta hoặc Meta + Pancake POS; chọn kết nối và Page. Giữ nguồn cơ sở và cách tính cũ, không thay enum nguồn hay biến SĐT Sheets hiện tại khi không cần thiết.

Danh mục dropdown thêm nhóm Botcake:
- SĐT mới ghi nhận trong kỳ: đếm các bản ghi mới, không gồm dữ liệu nền.
- SĐT mới đã nối campaign và SĐT mới chưa xác định nguồn.
- Chi phí/SĐT mới: chi phí Meta chia số mới đúng phạm vi Page/campaign/kỳ; không chia cho 0.
- Tổng SĐT đã ghi nhận: gồm tập nền, nhãn phân biệt rõ với số mới.

Công thức tùy chỉnh dùng biến Botcake riêng, không chiếm tên chỉ số/custom field cũ. Chưa đồng bộ đủ hoặc thiếu phạm vi phải hiện chưa đủ dữ liệu, không giả thành 0. Telegram, web và lịch dùng cùng truy vấn sổ ghi nhận.

### Xem chi tiết

Thêm khung/tab SĐT Botcake với các cột: SĐT che mặc định, Page, PSID, ngày ghi nhận cố định, tương tác gần nhất, campaign tại ghi nhận và trạng thái nền/mới/chưa xác định nguồn. Lọc theo kỳ và Page. Từ báo cáo có thể mở danh sách số mới của kỳ tương ứng.

### Luồng sử dụng

Nguồn dữ liệu -> Kết nối Botcake -> Chọn trường SĐT -> Khởi tạo dữ liệu nền -> Mẫu & chỉ số chọn Page/chỉ số -> Đồng bộ định kỳ -> Báo cáo web/Telegram.

## Backend và an toàn dữ liệu

Module botcake độc lập cho client/schema/kết nối/sync/store/report. Các bản ghi khách, sổ SĐT và job/cursor tách khỏi bảng đơn POS. Tái sử dụng factory kết nối DB, kho token riêng tư, auth/CSRF/rate limit/CAS hiện có.

Lưu fingerprint HMAC của SĐT cho unique; khóa bền vững riêng, không lấy từ token Botcake hoặc mật khẩu dashboard để tránh thay token làm mất chống trùng. Nếu cần lưu/xem SĐT gốc thì mã hóa tại máy chủ và chỉ trả theo quyền dashboard. Không ghi SĐT/token/nội dung khách vào log; Telegram mặc định gửi thống kê.

Job có lease, cursor, retry và ngân sách từng lượt; lỗi không cập nhật mốc hoàn tất. Khởi tạo/dồng bộ dài tiếp tục ở lượt kế tiếp. Khối Botcake lỗi không chặn xử lý nguồn/lịch cũ. Đọc báo cáo từ Supabase thay vì quét toàn bộ Botcake trong mỗi lệnh Telegram.

## Tiêu chí nghiệm thu trước phát hành

- Cùng số ở hai định dạng, nhiều PSID, hai ngày, hai campaign hoặc hai job đồng thời: chỉ một bản ghi mới trên Page đó.
- Khác Page xử lý độc lập; xem/gửi lại báo cáo không tiêu thụ hay thay đổi số liệu.
- Đổi token, reconnect, retry và chuyển tháng giữ lịch sử.
- Baseline không bị cộng thành mới; job dở, null ngày và API lỗi không thành số 0.
- Ngày UTC đổi sang Việt Nam đúng ở 00:00; ngày đã ghi nhận không trôi theo tương tác hôm sau.
- Nguồn quảng cáo đóng băng tại ghi nhận, thiếu nguồn để riêng.
- Lưu cấu hình không ghi đè mẫu/nhóm; danh mục công thức cũ vẫn hợp lệ.
- Kiểm thử giao diện desktop/mobile, thao tác với API và các luồng cũ trước deploy.

## Phụ lục: giao diện và biến Telegram

Bản xem thử tương tác: /Users/macbookpro/.codex/visualizations/2026/11/03/01a1a208-e25f-7192-844a-b16b17a0c9fa/botcake-report-ui.html

Bốn màn hình: kết nối Botcake; chỉ số/công thức; tin nhắn Telegram; sổ SĐT theo Page. Giữ sidebar và màu thương hiệu của ứng dụng. Bản xem thử có dữ liệu minh họa, không gọi API hoặc lưu cấu hình Production.

Tên biến đề xuất, dành riêng cho provider Botcake để tránh ghi đè biến/custom metric cũ:

| Placeholder trong tin nhắn | Loại | Phạm vi/ý nghĩa |
|---|---|---|
| {{BOTCAKE_SDT_MOI}} | Số | SĐT mới theo Page và kỳ đã chọn; có thể gồm nguồn chưa gán |
| {{BOTCAKE_SDT_KHOP_CAMP}} | Số | SĐT mới nối được với campaign thuộc mẫu |
| {{BOTCAKE_SDT_CHUA_GAN}} | Số | SĐT mới của Page chưa xác định được nguồn |
| {{BOTCAKE_TONG_SDT}} | Số | Tổng đã ghi nhận theo Page, có dữ liệu nền; không phải số mới trong kỳ |
| {{BOTCAKE_CP_SDT_MOI}} | Tiền | Chi phí Meta / BOTCAKE_SDT_KHOP_CAMP; không dùng số chưa gán để hạ CPA |
| {{BOTCAKE_TEN_PAGE}} | Văn bản | Tên các Page đang chọn |
| {{BOTCAKE_DONG_BO_LUC}} | Văn bản | Thời điểm đồng bộ, trình bày theo giờ Việt Nam |
| {{BOTCAKE_TRANG_THAI}} | Văn bản | Đã đồng bộ đủ / đang khởi tạo / chưa đủ |
| {{BOTCAKE_CHI_TIET_CAMP}} | Khối văn bản | Dòng chi tiết số mới và chi phí theo campaign |

Nếu Page có các campaign ngoài phạm vi mẫu thì số mới theo Page không được gán ngầm cho campaign đã chọn. UI ghi rõ phạm vi từng chỉ số; mẫu chi phí/SĐT dùng số đã nối đúng campaign.

Nhóm biến: Botcake số/tiền, Botcake văn bản, chỉ số tự tính, Meta/POS và biến sẵn có. Dropdown tìm theo tên/mã; nút Chèn biến chèn đúng vị trí con trỏ trong textarea; danh mục chỉ gồm chỉ số đang chọn, biến văn bản phù hợp nguồn và công thức đã lưu. Nội dung soạn và bản tin đã thay biến có bộ đếm độ dài riêng.

Ví dụ công thức: chi_phi / BOTCAKE_SDT_KHOP_CAMP; mã chỉ số tùy chọn cp_sdt_chat_luong -> chèn bằng {{cp_sdt_chat_luong}}. Biểu thức hỗ trợ + - * /, ngoặc và số âm, không eval. Biến văn bản không dùng trong phép tính. Không biết biến, thiếu dữ liệu hoặc chia 0 phải có phản hồi rõ.

Ví dụ minh họa mặc định: chi phí 1.800.000 đ, mới theo Page 36, đã nối campaign 30, chưa gán 6 -> CP/SĐT đã nối 60.000 đ. Ngày 19 các khách đó quay lại -> số mới 0, chi phí/SĐT chưa tính được; ngày ghi nhận 18 giữ nguyên. Đây là tình huống thiết kế, không phải số liệu tài khoản thật.

QA bản xem thử: DOM tương tác xác nhận chèn tại caret, placeholder thiếu, plain-text chống chèn HTML, ưu tiên toán tử, công thức riêng thành placeholder, chặn biểu thức không hợp lệ/chia 0, chọn Page, bốn màn hình, đổi ngày giữ chống trùng, trạng thái đồng bộ thiếu và lưu/khôi phục lựa chọn. Chưa kiểm chứng hình ảnh trên trình duyệt thật trong phiên này.
