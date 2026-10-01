# Nuyen – App Tracker (TikTok BC)

Web dashboard theo dõi **khách đang chạy app nào** dựa trên **BC ID**, kèm ROAS IAA D0, spend, top geo, top campaign, campaign chạm max budget và hiệu quả creative.

## Tính năng

| Tab | Nội dung |
|---|---|
| **Theo level** | Bảng phân cấp **BC (chọn) → Account → Campaign → Geo → Creative**. Level 2 đổi được Account ⇄ App. Creative dưới mỗi geo = creative chạy ở nước đó trong campaign đó. Mỗi level đều có **Spend, ROAS IAA D0**; level BC/Account/Campaign có thêm cột **Top geo** (3 nước spend cao nhất, rê chuột xem ROAS từng nước) và trạng thái (đang chạy / link Event Manager chưa spend / chạm max budget). **Sort mọi level** từ trên xuống theo Spend hoặc ROAS IAA D0. Có ẩn dòng spend nhỏ, mở tới level, tìm kiếm (cả tên creative), 🎯 lọc toàn dashboard. |
| **Tổng quan** | KPI (Spend, IAA revenue D0, ROAS IAA D0, số app đang chạy, số lần chạm budget) · Spend theo ngày · ROAS IAA D0 theo ngày · Top geo · Top campaign · Bảng chạm max budget |
| **Campaign & Budget** | Danh sách campaign với budget ngày (CBO hoặc tổng budget ad group), max % budget/ngày, số ngày chạm max · bảng chi tiết campaign/ad group-ngày có spend ≥ 95% budget |
| **Creative** | Gom theo video (tên file `.mp4`) hoặc theo ad name: spend, ROAS IAA D0, top geo + scatter Spend vs ROAS |

Bộ lọc ngày: **Today / Yesterday / Last 3 days / Last 7 days / Custom** (tối đa 30 ngày), tuỳ chọn "gồm hôm nay" cho Last N days.

**Múi giờ:** mỗi ad account được query với khoảng ngày tính theo **múi giờ của chính account đó** (lấy từ `advertiser/info`). Ví dụ lúc 01:00 giờ Tokyo, "Today" của account Tokyo là ngày mới, còn account Los Angeles vẫn là ngày hôm trước. Thanh trên cùng hiển thị khoảng ngày thực tế cho từng múi giờ.

## Dữ liệu lấy từ đâu (TikTok Business API v1.3)

| Dữ liệu | Endpoint |
|---|---|
| Danh sách BC | `bc/get` |
| Ad account trong BC | `bc/asset/get` (asset_type=ADVERTISER) + `advertiser/info` (timezone, currency) |
| App trong **Event Manager** | `app/list` theo từng ad account |
| App mà mỗi ad đang chạy | metric `tt_app_id` trong `report/integrated/get` (level ad) – khớp với `app_id` của Event Manager |
| Spend / IAA revenue D0 / geo | `report/integrated/get` (campaign×ngày, ad group×ngày, ad, campaign×country, ad×country) |
| Budget | `campaign/get`, `adgroup/get` |

- **ROAS IAA D0** = `ad_impression_ad_revenue_day0` / `spend` — chính là `ad_impression_ad_revenue_roas_day0` của TikTok, nhưng tính từ revenue để cộng dồn đúng ở mọi level (BC, account, app, campaign, creative, geo). Đổi được bằng `IAA_REVENUE_METRIC`.
- Chọn được **nhiều BC** cùng lúc (ô "BC" trên cùng); ad account thuộc nhiều BC chỉ tính 1 lần.
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
