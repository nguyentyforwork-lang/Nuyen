# Nuyen – App Tracker (TikTok BC)

Web dashboard theo dõi **khách đang chạy app nào** dựa trên **BC ID**, kèm ROAS IAA D0, spend, top geo, top campaign, campaign chạm max budget và hiệu quả creative.

## Tính năng

| Tab | Nội dung |
|---|---|
| **Tổng quan** | KPI (Spend, IAA revenue D0, ROAS IAA D0, Installs/CPI, số app đang chạy, số lần chạm budget) · Spend theo ngày · ROAS IAA D0 theo ngày · Top geo · Top campaign · Bảng chạm max budget |
| **Account ↔ App** | Bảng pivot **kéo thả**: kéo chip `Account` / `App` / `Campaign` để đổi thứ tự nhóm (Account → App, App → Account, App → Account → Campaign…). Dòng có nhiều con thì bấm để xổ ra. Kéo tiêu đề cột để đổi thứ tự cột, bấm để sort. Nút 🎯 lọc toàn bộ dashboard theo dòng đó. Hiện cả app chỉ link trong Event Manager mà chưa spend. |
| **Campaign & Budget** | Danh sách campaign với budget ngày (CBO hoặc tổng budget ad group), max % budget/ngày, số ngày chạm max · bảng chi tiết campaign/ad group-ngày có spend ≥ 95% budget |
| **Creative** | Gom theo video (tên file `.mp4`) hoặc theo ad name: spend, IAA rev, ROAS IAA D0, installs, CPI, CTR + scatter Spend vs ROAS |

Bộ lọc ngày: **Today / Yesterday / Last 3 days / Last 7 days / Custom** (tối đa 30 ngày), tuỳ chọn "gồm hôm nay" cho Last N days.

**Múi giờ:** mỗi ad account được query với khoảng ngày tính theo **múi giờ của chính account đó** (lấy từ `advertiser/info`). Ví dụ lúc 01:00 giờ Tokyo, "Today" của account Tokyo là ngày mới, còn account Los Angeles vẫn là ngày hôm trước. Thanh trên cùng hiển thị khoảng ngày thực tế cho từng múi giờ.

## Dữ liệu lấy từ đâu (TikTok Business API v1.3)

| Dữ liệu | Endpoint |
|---|---|
| Danh sách BC | `bc/get` |
| Ad account trong BC | `bc/asset/get` (asset_type=ADVERTISER) + `advertiser/info` (timezone, currency) |
| App trong **Event Manager** | `app/list` theo từng ad account |
| App mà mỗi ad đang chạy | metric `tt_app_id` trong `report/integrated/get` (level ad) – khớp với `app_id` của Event Manager |
| Spend / IAA revenue / installs | `report/integrated/get` (campaign×ngày, ad group×ngày, ad, campaign×country) |
| Budget | `campaign/get`, `adgroup/get` |

- **ROAS IAA D0** = `total_in_app_ad_impr_value` / `spend`. Tên metric đã được kiểm tra trực tiếp với API. Có thể đổi bằng biến `IAA_REVENUE_METRIC` nếu tài khoản bạn dùng metric khác.
- **Chạm max budget**: spend trong ngày ≥ `BUDGET_HIT_THRESHOLD` (mặc định 95%) × budget ngày. Budget là budget **hiện tại** (API không trả budget theo lịch sử).
- Account khác currency (VND…) được quy đổi về USD theo `FX_TO_USD` để cộng dồn.

## Cài đặt & chạy

```bash
npm install
cp .env.example .env     # điền TIKTOK_ACCESS_TOKEN
npm start                # http://localhost:3000
```

- Không có `TIKTOK_ACCESS_TOKEN` → chạy **DEMO** với dữ liệu giả để xem giao diện.
- `APP_PASSWORD` → bật Basic Auth cho web.
- Kết quả được cache `CACHE_TTL` giây; nút **Refresh** để lấy dữ liệu mới ngay.
- `CONCURRENCY` = số ad account query song song (TikTok giới hạn QPS, nên để 3–5).

Access token cần các quyền: Business Center (đọc asset), Ad Account Management, Reporting, App Management.

```bash
npm test   # test logic múi giờ + service
```
