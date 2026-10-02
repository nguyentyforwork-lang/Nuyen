# Nuyen – TikTok Ads Monitor

Web nội bộ quản lý appeal TikTok Ads theo 2 luồng:

**① Account bị suspend** → *Kiểm tra creative* (tìm ad vi phạm) → *Appeal creative* bằng template (bulk nhiều account một lần) → *Appeal account* (copy nội dung có sẵn, dán vào Ads Manager, đánh dấu đã appeal). Lọc account theo ngày bị suspend, xuất CSV.

**② Account đang chạy nhưng có creative bị báo policy** → *Bulk appeal* nhiều account một lần, trước khi account bị khoá.

Mỗi account có thanh tiến độ (Kiểm tra ✓ → Appeal creative x/y → Appeal account ✓). Bulk appeal chạy nền, có thanh tiến độ và xem trước nội dung từng appeal trước khi gửi.

Không cần cài thư viện ngoài — chỉ cần Node.js ≥ 18.

## Chạy nhanh

```bash
cp .env.example .env      # điền token TikTok
npm start                 # mở http://localhost:3000
```

Thử giao diện với dữ liệu giả (không gọi TikTok): `npm run mock`.

## Cấu hình `.env`

| Biến | Ý nghĩa |
|---|---|
| `TIKTOK_ACCESS_TOKEN` | Access token TikTok Business API (app của bạn trên business-api.tiktok.com) |
| `TIKTOK_APP_ID`, `TIKTOK_SECRET` | Dùng để liệt kê mọi ad account token được ủy quyền |
| `TIKTOK_BC_IDS` | (tuỳ chọn) Business Center ID, cách nhau dấu phẩy — lấy toàn bộ account trong BC |
| `TIKTOK_ADVERTISER_IDS` | (tuỳ chọn) thêm advertiser ID thủ công |
| `APP_PASSWORD` | Mật khẩu Basic Auth bảo vệ trang (**nên đặt** khi deploy) |
| `TZ_DISPLAY` | Múi giờ dùng để lọc theo ngày (mặc định `Asia/Ho_Chi_Minh`) |
| `CREATIVE_LOOKBACK_DAYS` | Chỉ quét ad tạo trong N ngày gần nhất (mặc định 90) |

App TikTok cần quyền: *Ad Account Management*, *Ads Management* (đọc ad + review info + appeal), và *Business Center* nếu dùng `TIKTOK_BC_IDS`.

## Cách hoạt động

- **Account bị suspend**: gọi `/advertiser/info/`, coi các trạng thái `STATUS_LIMIT`, `STATUS_DISABLE`, `STATUS_CONFIRM_FAIL`, `STATUS_CONFIRM_FAIL_END` là bị khoá.
  TikTok API **không trả về ngày bị suspend**, nên app lưu lịch sử trạng thái mỗi lần quét: *ngày suspend = lần quét đầu tiên thấy account chuyển sang bị khoá*.
  Account đã bị khoá sẵn trước lần quét đầu tiên được đánh dấu `≈` (ngày ước lượng). Bật quét tự động (mặc định 60 phút/lần) để ngày chính xác.
- **Creative vi phạm**: gọi `/ad/get/` lấy ad có `secondary_status` bị từ chối, rồi `/ad/review_info/` để lấy lý do + trạng thái appeal.
  Khi ad không còn bị từ chối, nó chuyển sang mục “Đã được duyệt lại / xoá”.
- **Account bị suspend – kiểm tra sâu**: khi account bị khoá, `secondary_status` của mọi ad đều thành `ADVERTISER_ACCOUNT_PUNISH`, nên app gọi `/ad/review_info/` cho **tất cả** ad của account để tìm đúng ad bị từ chối.
- **Appeal**: gọi `/adgroup/appeal/` với `adgroup_id` + `ad_id` + nội dung từ template.
  Mặc định bỏ qua ad đã appeal / đang được xét; ad appeal bị lỗi được gửi lại.
  Auto appeal (tab *Cài đặt*) chọn được phạm vi (tất cả / chỉ account suspend / chỉ account đang chạy), giới hạn số lần appeal mỗi ad (mặc định 1) và số appeal mỗi lần chạy.
- **Template** (tab *Template*): có sẵn template cho Misleading claims, Landing page, Prohibited products, IP/brand, Low quality, Sensitive content + 1 template appeal account.
  Chế độ “Tự chọn theo lý do vi phạm” dùng template đầu tiên có *từ khoá* xuất hiện trong lý do TikTok trả về; không khớp thì dùng template mặc định.
  Biến: `{ad_name} {ad_id} {advertiser_id} {advertiser_name} {company} {reason}`.
- **Appeal account bị suspend**: TikTok Business API **không có** endpoint appeal cho account — phải làm trong Ads Manager / Business Center (web có link sẵn tới từng account).

Dữ liệu lưu ở `data/db.json` (đã được `.gitignore`). Server cần chạy liên tục (VPS, pm2, Docker…) để quét định kỳ.

## API

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/accounts?from=YYYY-MM-DD&to=YYYY-MM-DD&view=suspended\|current\|all&q=` | Account bị suspend theo ngày |
| GET | `/api/creatives?from&to&state=rejected\|resolved\|all&appeal=none\|done&q=` | Creative bị từ chối |
| POST | `/api/scan/accounts`, `/api/scan/creatives`, `/api/scan/full` | Quét ngay |
| GET | `/api/groups?type=suspended\|active&from&to&q` | Account kèm creative vi phạm + tiến độ (2 luồng) |
| POST | `/api/appeal/preview` | Xem trước nội dung appeal (body như dưới) |
| POST | `/api/appeal/bulk` `{ "advertiser_ids": [...] \| "ad_ids": [...], "template_id": "auto"\|id, "text"?, "skip_appealed": true }` | Bulk appeal chạy nền |
| GET | `/api/appeal/job` | Tiến độ bulk appeal |
| POST | `/api/accounts/account-appealed` `{ "advertiser_ids": [...] }` | Đánh dấu đã appeal account |
| GET/POST | `/api/templates`, `/api/templates/delete` | Quản lý template |
| GET | `/api/export/accounts.csv`, `/api/export/creatives.csv` | Xuất CSV (cùng tham số lọc) |
| GET/POST | `/api/settings` | Bật/tắt auto quét, auto appeal, phạm vi, template mặc định |

## Test

```bash
npm test
```
