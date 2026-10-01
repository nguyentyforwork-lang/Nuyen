# KPI App Ecomdy

Dashboard spend và ROAS IAA D0 theo app cho các camp TikTok có chữ "Ecomdy".

Nhập nhóm + ID tài khoản quảng cáo, trang tự kéo report qua connector **TikTok MCP** (`report_integrated_get`, `campaign_get`):

- ROAS IAA D0: `ad_impression_ad_revenue_roas_day0`
- ROAS IAP D0: `total_purchase_roas_day0` (trong bảng Theo ngày)

Kéo số tự động chỉ chạy khi mở trang trên Claude (artifact) vì cần connector của người xem. Mở file này ở nơi khác (GitHub Pages) chỉ hiện giao diện và cấu hình, không có số liệu.
