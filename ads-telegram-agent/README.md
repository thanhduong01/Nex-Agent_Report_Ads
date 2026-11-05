# Agent báo cáo quảng cáo qua Telegram

Agent đọc file Google Sheets theo tháng, tính chỉ số bằng code và gửi báo cáo
ngày hôm trước lúc **09:00, Asia/Ho_Chi_Minh**. Phần nhận xét AI có thể bật thêm.
Đây là mã nguồn đã chuẩn bị để kết nối và triển khai; chưa có credentials hoặc
lịch chạy nào được kích hoạt trên cloud.

## Mở bảng điều khiển Trạm Ads

Trong thư mục dự án, dùng Node.js 24, chạy `npm ci` nếu chưa cài thư viện,
rồi chạy `npm run ui`. Giữ cửa sổ Terminal mở và vào
[Trạm Ads trên máy này](http://127.0.0.1:4317).

1. Ở **Báo cáo**, chọn ngày để xem chi phí, tin nhắn, SĐT và số sản phẩm đã nhập từng chỉ số. Bấm **Xem trước bản tin** để đọc nội dung sẽ gửi.
2. Ở **Kết nối**, dán token của BotFather rồi chọn **Tạo liên kết ghép nối**. Mở liên kết, nhấn **Start** trong Telegram và quay lại bấm **Đã nhấn Start · Xác nhận**. Chỉ cuộc trò chuyện riêng có mã ghép nối đó được lưu. [Cơ chế liên kết của Telegram](https://core.telegram.org/bots/features#deep-linking).
3. Trở lại bản xem trước, chọn **Gửi thử vào chat đã kết nối** rồi kiểm tra tin nhắn trong Telegram.
4. Khi cài đặt lần đầu hoặc sang tháng mới, mở **Kết nối → Nguồn Google Sheets → Thêm file cho tháng mới**. Chọn một ngày của tháng vừa thêm để kiểm tra quyền đọc và các tab.

Bảng điều khiển lưu cấu hình vào `.env.local` trên máy. Để chạy lịch 09:00 độc lập với máy tính, thực hiện các bước 5 và 6 bên dưới rồi cập nhật cấu hình trên Vercel khi đổi bot hoặc thêm nguồn.

## Quy tắc đã chốt

- Mỗi tháng dùng một file Google Sheets, đăng ký trong cấu hình riêng của môi trường chạy.
- Ngày 01/11 gửi báo cáo ngày 31/10, lấy file tháng 10.
- Hàn Quốc, Thượng Hải, Đài Loan: chi phí, tin nhắn và SĐT.
- Khách Sạn: chi phí và tin nhắn; **không theo dõi SĐT**.
- Chi phí/SĐT tổng chỉ dùng chi phí và SĐT của ba sản phẩm có theo dõi.
- Các dòng ngày bắt đầu ở dòng 4. Dòng 3 là tổng, không cộng cùng dữ liệu ngày.
- Cột được nhận diện bằng tiêu đề. Tab Hàn Quốc tháng 10 dùng H/I/K cho
  chi phí/tin nhắn/SĐT; tháng 11 đổi sang F/G/I. Cả hai cấu trúc được hỗ trợ.
- Ô trống không được hiểu là số 0 hoặc tự suy ra chiến dịch đã dừng.
- Không lấy các cột giá/tin nhắn, giá/SĐT tính sẵn: một số công thức nguồn
  trả toàn bộ chi phí khi mẫu số bằng 0. Agent tự tính lại từ số liệu gốc.
- Tab KPI có tham chiếu lỗi, chưa dùng để báo cáo chốt sale, lãi hoặc ROAS.
- Đơn vị hiển thị đang giả định **VND**; sửa `settings.currency` nếu nguồn dùng
  tiền tệ khác. Chi phí lấy đúng cột CP Ads, không tự cộng thêm VAT/phí ngân hàng.

## 1. Chạy bản xem trước

Yêu cầu Node.js 24. Trong Terminal, vào thư mục dự án này:

```bash
nvm install 24
nvm use 24
npm ci
npm run demo
```

`demo` dùng dữ liệu ngày 02/11/2026 đã tải, không gọi AI, không gửi Telegram.
File dữ liệu mẫu nằm trong `fixtures/2026-10.json` và `fixtures/2026-11.json` trên máy hiện tại và được loại
khỏi Git/deployment. Nếu chuyển code qua máy khác, cần cung cấp fixture riêng
hoặc chuyển sang đọc Sheets sau bước 3. Bản xem trước đã tạo ở
`outputs/bao-cao-2026-11-02.txt`.

```bash
npm run demo -- --output outputs/bao-cao-2026-11-02.txt
(umask 077; cp -n .env.example .env.local)
```

Điền cấu hình trong `.env.local`; không gửi token/khóa vào chat hoặc đưa lên Git.

## 2. Tạo Telegram bot và lấy nơi nhận

1. Mở [BotFather](https://t.me/BotFather), gửi `/newbot`, đặt tên bot.
2. Lưu token vào `TELEGRAM_BOT_TOKEN` trong `.env.local`.
3. Mở bot mới, nhấn **Start** và gửi một tin nhắn.
4. Chạy `npm run telegram:chat` ngay sau đó. Chọn chat của bạn trong kết quả,
   điền ID vào `TELEGRAM_CHAT_ID`.
5. Để nhận ngay bản thử có số liệu thật, chạy `npm run telegram:preview -- --date 2026-11-02`.
   Mỗi lần chạy lệnh này sẽ gửi một tin có nhãn **BẢN GỬI THỬ** vào chat riêng đã chọn.
   Bước này chỉ cần token và chat ID khi dùng hai file đã chia sẻ. Redis và lịch
   production được thiết lập sau ở bước 5–6.

Script chỉ đọc các chat riêng tư từ `getUpdates`, không đổi webhook và không
gửi tin. Nếu dùng bot đã có webhook ở hệ thống khác, script dừng để tránh xung
đột; dùng một bot riêng cho báo cáo. Luồng thông báo một chiều không cần webhook.

Nguồn: [Telegram tutorial](https://core.telegram.org/bots/tutorial),
[Bot API](https://core.telegram.org/bots/api#getupdates).

## 3. Kết nối Google Sheets

Sau khi đăng ký file trong bảng điều khiển, bạn có thể chạy
`npm run report -- --date YYYY-MM-DD` cho một ngày thuộc tháng đã đăng ký.
Agent tải bản Excel từ Google vào bộ nhớ và lấy số liệu của bốn tab sản phẩm.
Nếu bạn dùng file riêng tư, làm các bước dưới đây. Đặt `SHEETS_REQUIRE_AUTH=true`
nếu muốn buộc agent luôn dùng tài khoản Google. Thông tin đăng nhập đã cấu hình
được ưu tiên, kể cả khi dùng file có thể đọc qua liên kết.

1. Tạo/chọn project trong Google Cloud Console và bật **Google Sheets API**.
2. Vào **IAM & Admin → Service Accounts**, tạo service account.
3. Trong **Keys → Add key → Create new key → JSON**, tạo khóa cho tài khoản đó
   nếu chính sách tổ chức cho phép. Lưu khóa ở thư mục riêng ngoài repository.
4. Chia sẻ file báo cáo cho email service account với quyền **Viewer**.
5. Trên máy: đặt `GOOGLE_APPLICATION_CREDENTIALS` trong `.env.local` bằng đường
   dẫn tuyệt đối của file JSON. Trên cloud: đặt `GOOGLE_SERVICE_ACCOUNT_JSON`
   bằng toàn bộ JSON trong phần Environment Variables.

Không cần công khai Sheets. Agent dùng thư viện xác thực của Google và chỉ yêu
cầu `spreadsheets.readonly`. IAM role trên Cloud không thay cho quyền chia sẻ file.

Nguồn: [Tạo credentials và chia sẻ file](https://developers.google.com/workspace/guides/create-credentials),
[Quyền Sheets API](https://developers.google.com/workspace/sheets/api/scopes).

## 4. Đăng ký file từng tháng

Danh sách file được lưu trong `REPORT_SOURCES_JSON` ở `.env.local` và
Environment Variables của cloud. Ví dụ cấu hình cho một tháng:

```dotenv
REPORT_SOURCES_JSON='{"2026-12":{"spreadsheetId":"ID_FILE_THANG_12"}}'
```

`spreadsheetId` là đoạn giữa `/d/` và `/edit` trong đường dẫn Google Sheets.
Giữ lại các tháng cũ để so sánh qua đầu tháng. Mỗi tháng cần một mục
có `spreadsheetId` trong cấu hình.

Nếu muốn ghi nhận đã chốt dữ liệu, thêm `confirmedThrough: "2026-11-02"` vào
đúng tháng sau khi người phụ trách xác nhận; không tự lấy ngày đọc làm ngày chốt.
Nếu chưa có mốc xác nhận, báo cáo vẫn gửi nhưng ghi rõ là số liệu tại lúc đọc.
Giữ tên tab, ba hàng tiêu đề và tên các chỉ số như mẫu. Các cột có thể dịch chuyển
trong A:M; agent nhận diện theo tiêu đề. Nếu thêm cột vượt M cần mở rộng vùng
đọc trong `sheets.ts`. Agent báo lỗi khi thiếu/trùng tiêu đề hoặc trùng dòng ngày.

Mỗi tháng bạn chỉ cần đăng ký ID mới và chia sẻ file cho service account.
Với file đã cho phép tải theo liên kết, bạn cũng có thể thêm `"allowSharedExport":true`
vào cấu hình của riêng tháng đó.
Agent chọn file theo tháng của ngày báo cáo. Đường dẫn nguồn thực được lưu
riêng trong cấu hình của từng môi trường.

## 5. Xem trước dữ liệu thật và kết nối lịch sử gửi

```bash
npm run report -- --date 2026-11-02
```

Lệnh này chỉ đọc và in báo cáo. Không có `--send` thì không gửi Telegram.

Để lưu lịch sử gửi qua các lần khởi động/deploy, tạo một cơ sở dữ liệu Redis
trong [Upstash](https://console.upstash.com/redis). Điền hai biến từ phần REST API:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Báo cáo chính thức và trạng thái gửi được lưu trong Redis. Bản thử qua Telegram
và lệnh xem trước trên máy có thể chạy trước khi thiết lập Redis.

Gửi thử đến đúng chat đã cấu hình:

```bash
npm run send -- --date 2026-11-02
```

Lệnh này **thực sự gửi** một báo cáo. Khóa chống trùng gồm nơi nhận + ngày báo
cáo. Chạy lại ngày đã gửi sẽ không gửi thêm. Nguồn:
[Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi).

## 6. Triển khai và bật lịch 09:00

Kiểm tra trước:

```bash
npm test
npm run typecheck
npm run build
```

Liên kết project Vercel bằng `npx eve link`. Trong Vercel Environment Variables,
điền cấu hình Google, Telegram, Redis và nguồn theo tháng. Giữ `SEND_REPORTS=false`
cho đến khi gửi thử thành công. Không đưa `.env.local` hoặc khóa JSON lên Git.

```bash
npx eve deploy
```

Sau khi xác nhận nơi nhận và dữ liệu đúng, đặt `SEND_REPORTS=true` cho môi trường
Production, redeploy, rồi kiểm tra **Settings → Cron Jobs** có lịch 09:00 giờ
Việt Nam (02:00 UTC). Xem lịch sử chạy trong **Observability → Cron Jobs / Logs**.
Chọn gói hosting có độ chính xác lịch chạy phù hợp yêu cầu 09:00; thời điểm
thực tế phụ thuộc scheduler và thời gian xử lý, không cam kết đúng từng giây.

Lịch `eve dev` không tự chạy; `npm run dev` chỉ phục vụ phát triển. Triển khai
cloud mới giúp bot chạy khi máy tính tắt. Nếu tự host phải dùng `eve start`
và giữ tiến trình chạy, với múi giờ tiến trình là UTC cho lịch hiện tại.

Nguồn: [Eve schedules](https://eve.dev/docs/schedules),
[Eve deployment](https://eve.dev/docs/guides/deployment/vercel).

## Nhận xét AI (tùy chọn)

Đặt `AI_ENABLED=true` sau khi kết nối AI Gateway. Local có thể dùng
`AI_GATEWAY_API_KEY`; Vercel có thể dùng project OIDC. Model mặc định là model
do Eve scaffold chọn, cấu hình được bằng `REPORT_MODEL`. Model chỉ nhận bảng
chỉ số đã tính, không nhận các tab thưởng/sale. Phần nhận xét được ghi nhãn AI.
Nếu AI lỗi, báo cáo số liệu vẫn được gửi. Dùng AI có phát sinh usage theo model.

Trong hội thoại Eve, tool `read_daily_report` cho phép hỏi dữ liệu theo ngày.
Telegram ở phiên bản này là kênh nhận thông báo, chưa có chức năng hỏi đáp.
Agent chỉ được cấp tool đọc báo cáo; các công cụ shell, sửa file, tìm web và
ủy nhiệm mặc định của framework đã được tắt.

## Lỗi và giới hạn cần biết

- Dữ liệu thiếu: gửi phần đã ghi nhận và nhãn thiếu dữ liệu. Ô có công thức tổng
  bằng 0 nhưng chi tiêu gốc trống vẫn được xem là chưa nhập, không kết luận đã dừng.
- Chưa đăng ký file tháng mới hoặc mất quyền đọc: gửi thông báo lỗi nguồn một
  lần cho ngày đó. Sau khi sửa, chạy `npm run send -- --date YYYY-MM-DD`.
- Google Sheets lỗi tạm thời: thử đọc tối đa 3 lần. Phiên bản này không có lịch
  tự đọc bổ sung sau 09:00 nếu nhân viên nhập muộn.
- Telegram trả lỗi rõ ràng 4xx: lưu `failed`; có thể chạy lại sau khi sửa.
- Timeout hoặc kết quả gửi không rõ: lưu `uncertain`; nếu tiến trình chết có
  thể còn `pending`. Không tự gửi lại để tránh gửi trùng. Kiểm tra Telegram và
  bản ghi `ads:*` trong Redis; nếu xác nhận chưa nhận, đổi trạng thái thành
  `failed` rồi chạy lại. Không thể bảo đảm exactly-once khi API gửi tin không
  hỗ trợ khóa idempotency. Bản ghi `sent` giữ mã tin nhắn để đối chiếu.
- Nếu Telegram hoặc Redis không truy cập được thì không thể thông báo lỗi qua
  chính kênh đó; cần xem log hosting. Không có kênh cảnh báo dự phòng.
- Chưa đặt ngưỡng đánh giá CPL/tin nhắn vì chưa có mục tiêu kinh doanh. Hiện chỉ
  nêu sự kiện có chi phí nhưng kết quả bằng 0, không tự đổi ngân sách quảng cáo.

## Tệp chính

- `agent/lib/config.ts`: nguồn tháng, cột dữ liệu, lịch gửi, sản phẩm theo dõi SĐT.
- `agent/lib/report.ts`: kiểm tra dữ liệu, tổng hợp, so sánh, dựng tin nhắn.
- `agent/lib/sheets.ts`: quyền đọc và lấy dữ liệu Sheets.
- `agent/lib/delivery.ts`: gửi Telegram, lịch sử gửi và chống trùng.
- `agent/schedules/daily-report.ts`: lịch 09:00 Việt Nam.
- `.env.example`: danh sách biến cần điền, không chứa credentials.
