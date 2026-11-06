# Nex Report Ads Performance

Agent đọc file Google Sheets theo tháng, tính chỉ số bằng code và gửi báo cáo
ngày hôm trước lúc **09:00, Asia/Ho_Chi_Minh**. Phần nhận xét AI có thể bật thêm.
Đây là mã nguồn đã chuẩn bị để kết nối và triển khai; chưa có credentials hoặc
lịch chạy nào được kích hoạt trên cloud.

## Mở bảng điều khiển Nex Report Ads Performance

Trong thư mục dự án, dùng Node.js 24, chạy `npm ci` nếu chưa cài thư viện,
rồi chạy `npm run ui`. Giữ cửa sổ Terminal mở và vào
[Nex Report Ads Performance trên máy này](http://127.0.0.1:4317).

1. Ở **Báo cáo**, chọn ngày để xem chi phí, tin nhắn, SĐT và số sản phẩm đã nhập từng chỉ số. Bấm **Xem trước bản tin** để đọc nội dung sẽ gửi.
2. Ở **Kết nối**, dán token của BotFather rồi chọn **Tạo liên kết ghép nối**. Mở liên kết, nhấn **Start** trong Telegram và quay lại bấm **Đã nhấn Start · Xác nhận**. Chỉ cuộc trò chuyện riêng có mã ghép nối đó được lưu. [Cơ chế liên kết của Telegram](https://core.telegram.org/bots/features#deep-linking).
3. Trở lại bản xem trước, chọn **Gửi thử vào chat đã kết nối** rồi kiểm tra tin nhắn trong Telegram.
4. Mở **Kết nối → Nhóm báo cáo & nguồn dữ liệu**, tạo nhóm, chọn tháng, dán đường dẫn Sheets và chọn **Đọc các tab & nhận diện chỉ số**. Chọn tab và kiểm tra các cột rồi lưu nguồn.

Bảng điều khiển local lưu nhóm trong `.data/report-groups.json` và thông tin bot trong `.env.local`. Bản web lưu nhóm vào Vercel Blob riêng tư. Nhóm và nguồn mới có hiệu lực sau khi lưu. Để chạy lịch 09:00 độc lập với máy tính, thực hiện các bước 5 và 6 bên dưới.

Giao diện cũng được đóng gói trong `public/` để phục vụ tại đường dẫn gốc
của bản deploy. API web được đăng ký qua channel `dashboard`. Trên Vercel,
đặt `DASHBOARD_PASSWORD` là mật khẩu bạn muốn dùng (không để trống) và đăng nhập trước khi xem dữ liệu.
Cấu hình Telegram trên web được cập nhật qua Environment Variables của project rồi Redeploy. Nhóm báo cáo được quản lý trực tiếp trên web. Gửi thử và lệnh Telegram lưu trạng thái trong Vercel Blob riêng tư; Redis là lựa chọn thay thế nếu đã cấu hình.

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
   Bước này chỉ cần token và chat ID khi dùng hai file đã chia sẻ. Kho lịch sử và lịch production được thiết lập sau ở bước 5–6.

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

## 4. Quản lý nhóm và nguồn động

Mỗi nhóm có tên, trạng thái gửi hằng ngày và danh sách nguồn theo tháng.
Cùng một file có thể đăng ký cho nhiều tháng với các tab tương ứng.

1. Vào **Kết nối**, chọn **Tạo nhóm** và đặt tên.
2. Chọn tháng và dán đường dẫn Google Sheets.
3. Bấm **Đọc các tab & nhận diện chỉ số**. Chọn các tab thuộc báo cáo của nhóm.
4. Mở **Cột dữ liệu** để kiểm tra cột ngày, kiểu ngày, dòng bắt đầu, chi phí Ads, tin nhắn, SĐT và các cột chi tiêu gốc.
5. Để trống cột SĐT với sản phẩm không theo dõi. Chọn **Kiểm tra & lưu nguồn**.
6. Chọn nhóm ở **Báo cáo** và xem một ngày đã có dữ liệu. Trong **Lịch gửi tự động**, chọn giờ, ngày trong tuần và ngày lấy số liệu; bật lịch rồi lưu nhóm.

Các mẫu hiện tại hỗ trợ bảng mỗi ngày một dòng, ngày đầy đủ hoặc số ngày 1–31,
vùng tối đa A1:AZ1000 và tối đa 12 tab trong một nguồn. Cột tổng chi phí Ads được
đọc theo ánh xạ. Các cột chi tiêu gốc giúp phân biệt ô trống với công thức trả 0.

Danh sách nhóm trên web lưu ở Vercel Blob riêng tư qua `BLOB_READ_WRITE_TOKEN`
do kết nối Storage tạo. Mỗi lần lưu kiểm tra phiên bản để bảo vệ thay đổi từ
cửa sổ khác. Lỗi kho lưu trữ được báo trực tiếp. Local dùng file riêng trong `.data/`.

`REPORT_SOURCES_JSON` chỉ phục vụ nhập cấu hình cũ vào nhóm mặc định khi chưa có
danh sách đã lưu. Khi danh sách đã tồn tại, chỉnh nguồn trên giao diện. File cũ
vẫn dùng bộ đọc nhận diện tiêu đề để hỗ trợ cột dịch chuyển giữa tháng.

GitHub Actions kiểm tra lịch mỗi 5 phút, gửi các nhóm đến hạn theo giờ Việt Nam. Mỗi nhóm có giờ, ngày trong tuần và lựa chọn báo cáo hôm nay/hôm qua riêng. Lịch mới có hiệu lực sau khi lưu, không deploy lại. `SEND_REPORTS` chỉ còn dùng cho nhóm cũ chưa từng lưu lịch trong giao diện; nhóm có lịch riêng được điều khiển hoàn toàn trên web.

## 5. Xem trước dữ liệu thật và kết nối lịch sử gửi

```bash
npm run report -- --date 2026-11-02
```

Lệnh này chỉ đọc và in báo cáo. Không có `--send` thì không gửi Telegram.

Bản web dùng Vercel Blob riêng tư đã kết nối để lưu trạng thái gửi qua các lần deploy. Không cần thêm Redis. Nếu đã có Redis, có thể giữ `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN`; ứng dụng sẽ ưu tiên Redis. Không chuyển kho lịch sử khi một lần gửi đang diễn ra.

Gửi thử đến đúng chat đã cấu hình:

```bash
npm run send -- --date 2026-11-02
```

Lệnh này **thực sự gửi** một báo cáo. Khóa chống trùng gồm nơi nhận + ngày báo
cáo. Chạy lại ngày đã gửi sẽ không gửi thêm. Nguồn:
[Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi).

## 6. Triển khai, nhận lệnh Telegram và đặt lịch

Nếu import từ GitHub, để Root Directory ở gốc repository hoặc chọn
`ads-telegram-agent`. Cấu hình `vercel.json` tại cả hai vị trí đặt Framework
Preset thành Other và build đúng thư mục. Giao diện tĩnh và API được đưa vào
Vercel Build Output cùng với lịch gửi. [Vercel Build Output API](https://vercel.com/docs/build-output-api).

Kiểm tra trước:

```bash
npm test
npm run typecheck
npm run build
```

Liên kết project Vercel bằng `npx eve link`. Cấu hình `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_PASSWORD` và kết nối Blob riêng tư. Không đưa `.env.local` hoặc khóa JSON lên Git.

Sau khi deploy, vào **Kết nối → Bot Telegram → Kết nối lệnh Telegram**. GitHub Actions cũng tự kết nối webhook khi kiểm tra lịch trên production. Bot đã có webhook ở hệ thống khác sẽ được giữ nguyên và báo cần kiểm tra. Webhook xác thực bằng secret HMAC từ token bot (hoặc `TELEGRAM_WEBHOOK_SECRET_TOKEN` nếu bạn tự cấu hình); token không đưa xuống trình duyệt.

Các lệnh mặc định trong chat riêng đã cấu hình (có thể sửa trong **Yêu cầu bot**):

- `/baocao`: số liệu hôm nay của tất cả nhóm có nguồn, kể cả nhóm đang tắt lịch.
- `/baocao Thượng Hải`: hôm nay của một nhóm; có thể dùng mã nhóm từ `/nhom`.
- `/baocao 02/11/2026 Thượng Hải`: báo cáo ngày chỉ định. Cũng hỗ trợ `YYYY-MM-DD`.
- `/homqua`: số liệu hôm qua; `/nhom`: danh sách nhóm; `/lich`: lịch và liên kết cấu hình; `/help`: hướng dẫn.

Bot chỉ nhận lệnh từ đúng chat riêng và người gửi trùng `TELEGRAM_CHAT_ID`. Lệnh được xử lý trực tiếp, không cần AI Gateway. Mỗi tin nhắn mới đọc lại Sheets; cập nhật gửi lại cùng message ID không gửi lặp. Số liệu hôm nay mang nhãn đang cập nhật.

## Cấu hình yêu cầu bot trên web

Mở **Yêu cầu bot → Tạo yêu cầu**, điền tên và lệnh không dấu, ví dụ `thuonghai` để dùng `/thuonghai`. Bạn có thể thêm tối đa 5 câu tương đương như “báo cáo Thượng Hải”, mỗi câu một dòng. Bot khớp nguyên câu, bỏ qua hoa thường, dấu tiếng Việt và khoảng trắng dư; không suy đoán ý từ câu tự do.

Chọn tất cả nhóm hoặc một số nhóm, ngày mặc định hôm nay/hôm qua, cho phép chọn ngày kèm lệnh và kiểu trả lời chi tiết/tổng quan. Tắt yêu cầu để bot ngừng nhận cả lệnh lẫn các câu tương đương. `/start`, `/help`, `/chatid`, `/nhom`, `/lich`, `/report`, `/homnay` dành cho hệ thống. Các lệnh và câu không được trùng giữa các yêu cầu.

**Chạy thử** dùng cấu hình đang chỉnh và đọc Sheets thật, chỉ hiện phản hồi trên web. Có thể thử `/thuonghai 02/11/2026` hoặc câu đã đặt. Chọn nhóm kèm lệnh chỉ được thu hẹp trong các nhóm của yêu cầu. **Lưu yêu cầu** có hiệu lực cho tin nhắn tiếp theo, không cần deploy. Để cập nhật ngay menu gợi ý Telegram, vào Kết nối và bấm **Kết nối & cập nhật menu lệnh**; GitHub Actions cũng cập nhật menu định kỳ.

Nguồn cũ tự có hai yêu cầu `/baocao` (hôm nay), `/homqua` (hôm qua). Nhóm, nguồn, lịch và yêu cầu dùng chung bản cấu hình có kiểm soát phiên bản trong Blob riêng tư; thao tác lưu không ghi đè thay đổi từ cửa sổ khác. Tối đa 20 yêu cầu. Yêu cầu lấy báo cáo và lịch tự gửi độc lập: tắt một yêu cầu không tắt lịch của nhóm.

## Chỉnh lịch tự động

Đặt lịch trong **Kết nối → chọn nhóm → Lịch gửi tự động**. Chọn giờ Việt Nam, ngày trong tuần, hôm nay/hôm qua và bật/tắt; bấm **Lưu nhóm & lịch gửi**. Nút bật lịch trên web là công tắc của nhóm, không cần chỉnh biến môi trường nữa. Lịch cũ chưa bật gửi tự động vẫn tắt khi nâng cấp.

GitHub Actions chạy workflow `.github/workflows/report-scheduler.yml` mỗi 5 phút trên nhánh `main` (phút 2, 7, 12, … UTC). Vercel Free chỉ phục vụ web/API, không cần Vercel Cron. Mỗi lần workflow chạy, API đọc lịch mới nhất trong Blob; sửa lịch trên web không cần tạo commit hoặc deploy. Workflow kiểm tra từng nhóm và chỉ gửi khi đến hạn. Lịch nhận báo cáo và yêu cầu Telegram vẫn dùng cấu hình riêng.

Kết nối GitHub → Vercel dùng OIDC ngắn hạn; API kiểm tra chữ ký GitHub, audience, repository/owner ID bất biến, nhánh `main`, đúng file workflow và loại sự kiện. Không cần PAT, token bot hay mật khẩu dashboard trong GitHub Secrets. API không trả nội dung báo cáo hoặc nguồn Sheets vào log công khai. Đổi repo/nhánh/domain phải cập nhật đồng thời workflow và `scheduler-auth.ts`.

Trang Kết nối hiển thị heartbeat (ghi nhận mỗi 15 phút) và liên kết lần chạy trên GitHub. **Actions → Report scheduler → Run workflow → probe** kiểm tra kết nối, không gửi tin. Chọn **run** chỉ xử lý lịch đến hạn, không ép gửi ngay. Sau push thay đổi bộ lập lịch, workflow tự kiểm tra kết nối production.

GitHub có thể chạy chậm hoặc bỏ lần chạy khi quá tải; lịch 5 phút không bảo đảm gửi đúng phút. Bộ kiểm tra bù các lần đến hạn trong vòng 2 giờ và chống gửi trùng bằng khóa nhóm/ngày/giờ/nơi nhận. Khi đổi lịch, không gửi bù giờ trước thời điểm lưu. Với repository public, GitHub có thể tự tắt scheduled workflow sau 60 ngày không có hoạt động repository; mở Actions để bật lại. Mọi lần gửi dùng lại lịch mới nhất, nên tắt lịch trước khi workflow xử lý sẽ ngăn gửi.

Nguồn: [GitHub schedule limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc).

`eve dev` không tự chạy lịch. Chạy cloud để bot hoạt động khi máy tính tắt; bản local UI phục vụ cấu hình và xem trước, không đăng ký webhook hoặc tự gửi lịch.

Nguồn: [Eve schedules](https://eve.dev/docs/schedules),
[Eve deployment](https://eve.dev/docs/guides/deployment/vercel).

## Nhận xét AI (tùy chọn)

Đặt `AI_ENABLED=true` sau khi kết nối AI Gateway. Local có thể dùng
`AI_GATEWAY_API_KEY`; Vercel có thể dùng project OIDC. Model mặc định là model
do Eve scaffold chọn, cấu hình được bằng `REPORT_MODEL`. Model chỉ nhận bảng
chỉ số đã tính, không nhận các tab thưởng/sale. Phần nhận xét được ghi nhãn AI.
Nếu AI lỗi, báo cáo số liệu vẫn được gửi. Dùng AI có phát sinh usage theo model.

Trong hội thoại Eve, tool `read_daily_report` cho phép hỏi dữ liệu theo ngày.
Telegram hỗ trợ các lệnh và câu yêu cầu đã cấu hình; chưa có hội thoại AI tự do.
Agent chỉ được cấp tool đọc báo cáo; các công cụ shell, sửa file, tìm web và
ủy nhiệm mặc định của framework đã được tắt.

## Lỗi và giới hạn cần biết

- Dữ liệu thiếu: gửi phần đã ghi nhận và nhãn thiếu dữ liệu. Ô có công thức tổng
  bằng 0 nhưng chi tiêu gốc trống vẫn được xem là chưa nhập, không kết luận đã dừng.
- Chưa đăng ký file tháng mới hoặc mất quyền đọc: gửi thông báo lỗi nguồn một
  lần cho ngày đó. Sau khi sửa, chạy `npm run send -- --date YYYY-MM-DD`.
- Google Sheets lỗi tạm thời: thử đọc tối đa 3 lần. Sau khi lần gửi lịch đã thành công, dùng /baocao để lấy số liệu mới nếu nhân viên nhập bổ sung.
- Telegram trả lỗi rõ ràng 4xx: lưu `failed`; có thể chạy lại sau khi sửa.
- Timeout hoặc kết quả gửi không rõ: lưu `uncertain`; nếu tiến trình chết có
  thể còn `pending`. Không tự gửi lại để tránh gửi trùng. Kiểm tra Telegram và
  bản ghi lịch sử trong Blob hoặc Redis; nếu xác nhận chưa nhận, đổi trạng thái thành
  `failed` rồi chạy lại. Không thể bảo đảm exactly-once khi API gửi tin không
  hỗ trợ khóa idempotency. Bản ghi `sent` giữ mã tin nhắn để đối chiếu.
- Nếu Telegram hoặc kho lịch sử không truy cập được thì không thể thông báo lỗi qua
  chính kênh đó; cần xem log hosting. Không có kênh cảnh báo dự phòng.
- Chưa đặt ngưỡng đánh giá CPL/tin nhắn vì chưa có mục tiêu kinh doanh. Hiện chỉ
  nêu sự kiện có chi phí nhưng kết quả bằng 0, không tự đổi ngân sách quảng cáo.

## Tệp chính

- `agent/lib/config.ts`: nguồn tháng, cột dữ liệu, lịch gửi, sản phẩm theo dõi SĐT.
- `agent/lib/report.ts`: kiểm tra dữ liệu, tổng hợp, so sánh, dựng tin nhắn.
- `agent/lib/sheets.ts`: quyền đọc và lấy dữ liệu Sheets.
- `agent/lib/delivery.ts`: gửi Telegram, lịch sử gửi và chống trùng.
- `agent/lib/scheduler-api.ts` và `.github/workflows/report-scheduler.yml`: kiểm tra lịch trên web bằng GitHub Actions.
- `.env.example`: danh sách biến cần điền, không chứa credentials.

## Rollback triển khai

Nếu cần quay lại bản trước, tắt workflow **Report scheduler** trên GitHub trước, sau đó promote deployment Vercel đã xác minh hoạt động. Không quay về commit có cron mỗi phút vì Vercel Hobby sẽ từ chối. Nguồn và lịch lưu trong Blob được giữ nguyên; kiểm tra đăng nhập, đọc báo cáo, `/api/schedule-tick` trả 401 khi thiếu token và trạng thái webhook trước khi bật workflow lại.

## Kiểm tra khi bot không phản hồi

Trong Kết nối, ứng dụng xác minh token, địa chỉ webhook và quyền truy cập chat riêng bằng Telegram API. Liên kết “Mở @...” dẫn đến đúng bot của token đang triển khai. Sau khi gửi `/help`, bấm kiểm tra kết nối để đọc trạng thái lệnh gần nhất: chưa nhận, bị bỏ qua do chat/người gửi không khớp, đang xử lý, đã gửi, đã ghi nhận hoặc lỗi kho lịch sử/Telegram. Dữ liệu chẩn đoán chỉ lưu thời điểm, giai đoạn và mã nguyên nhân trong Blob riêng tư; không lưu nội dung tin, chat ID hoặc token. “Đã kết nối” xác nhận cấu hình webhook, không tự khẳng định một lệnh đã được trả lời.

Để lấy đúng người nhận sau khi webhook đã kết nối, nhắn `/chatid` trong chat riêng với bot. Lệnh này chỉ trả ID của chính người nhắn, không đọc báo cáo hoặc tự đổi chủ sở hữu. Dùng số bot trả về cho `TELEGRAM_CHAT_ID`, lưu Production và redeploy. Không dùng phần số đứng trước dấu `:` trong bot token vì đó là ID của bot. `/help` và `/baocao` vẫn chỉ được xử lý cho đúng chủ sở hữu đã cấu hình.
