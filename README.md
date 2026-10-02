# Nuyen – TikTok Ads Monitor

Web nội bộ để:

1. **Kéo danh sách ad account bị suspend theo ngày** (lọc theo khoảng ngày, xuất CSV).
2. **Kéo creative (ad) bị từ chối / vi phạm** kèm lý do và gợi ý sửa từ TikTok.
3. **Appeal creative** thủ công (chọn nhiều ad) hoặc **auto appeal** sau mỗi lần quét.

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
- **Appeal**: gọi `/adgroup/appeal/` với `adgroup_id` + `ad_id` + lý do (mẫu trong *Cài đặt* hoặc nhập riêng).
  Auto appeal chỉ gửi cho ad chưa đang được appeal, giới hạn số lần appeal mỗi ad (mặc định 1) và số appeal mỗi lần chạy.
- **Appeal account bị suspend**: TikTok Business API **không có** endpoint appeal cho account — phải làm trong Ads Manager / Business Center (web có link sẵn tới từng account).

Dữ liệu lưu ở `data/db.json` (đã được `.gitignore`). Server cần chạy liên tục (VPS, pm2, Docker…) để quét định kỳ.

## API

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/accounts?from=YYYY-MM-DD&to=YYYY-MM-DD&view=suspended\|current\|all&q=` | Account bị suspend theo ngày |
| GET | `/api/creatives?from&to&state=rejected\|resolved\|all&appeal=none\|done&q=` | Creative bị từ chối |
| POST | `/api/scan/accounts`, `/api/scan/creatives`, `/api/scan/full` | Quét ngay |
| POST | `/api/appeal` `{ "ad_ids": [...], "reason": "..." }` | Gửi appeal |
| GET | `/api/export/accounts.csv`, `/api/export/creatives.csv` | Xuất CSV (cùng tham số lọc) |
| GET/POST | `/api/settings` | Bật/tắt auto quét, auto appeal, mẫu lý do |

## Test

```bash
npm test
```
