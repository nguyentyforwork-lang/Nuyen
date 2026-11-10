# Nuyen — Creative Spend Viewer (TikTok Ads)

Nhập **Ad Account ID** → hiển thị toàn bộ creative trong account cùng spend theo khoảng ngày.

## Tính năng
- Khoảng ngày: Hôm nay, 7/30 ngày, Tháng này/trước, **Đầu quý đến nay** (mặc định), Quý trước, Đầu năm đến nay, Tùy chỉnh.
- Nút **Hiện/ẩn creative không spend** (lấy cả ad không chạy trong khoảng ngày).
- Gom theo **Creative** (các ad dùng chung video/ảnh/post gộp làm 1) hoặc theo **Ad**.
- Sắp xếp spend tăng/giảm (hoặc bấm tiêu đề cột bất kỳ), lọc khoảng spend từ–đến, tìm kiếm.
- Spend, % spend, Impressions, Clicks, CTR, CPC, CPM, Conversions, CPA, ROAS, thumbnail video.
- Tùy chọn gồm cả ad đã xoá, xuất CSV.

## Chạy
Cần Node.js ≥ 18, không cần cài package.

```bash
cp .env.example .env   # điền TIKTOK_ACCESS_TOKEN
npm start              # http://localhost:3000
```

Có thể nhập token trong nút **⚙ Token** trên giao diện thay vì `.env`.
Gõ `demo` vào ô Account ID để xem với dữ liệu mẫu. Link chia sẻ: `http://localhost:3000/?acc=<ID>`.

## Nguồn dữ liệu
- `/ad/get/` — danh sách ad (kể cả không spend)
- `/report/integrated/get/` (AUCTION_AD, theo `ad_id`) — spend theo khoảng ngày, tự chia nhỏ nếu > 365 ngày
- `/file/video/ad/info/`, `/file/image/ad/info/` — thumbnail

Ngày tính theo múi giờ của ad account. Smart+ / GMV Max campaign không nằm trong báo cáo này.
