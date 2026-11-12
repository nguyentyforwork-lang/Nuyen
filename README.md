# Nuyen Video Gen

Upload **1 video concept** → web tự tạo:

- **10 video** giữ nguyên concept (bối cảnh, hành động, góc máy, ánh sáng, lời thoại) — **chỉ đổi nhân vật**.
- **3 video riêng**: **Hook · Hero · Promise** của concept đó.

Mỗi video có nút **Download**, mỗi nhóm có nút **Tải tất cả (.zip)** (kèm `prompts.txt`). Video lỗi có thể sửa prompt và bấm **Tạo lại**.

## Cách hoạt động

1. Gemini (`gemini-2.5-flash`) xem video gốc → tóm tắt concept, viết 1 prompt cảnh có chỗ trống `[CHARACTER]`, đề xuất 10 nhân vật khác nhau, và 3 prompt Hook/Hero/Promise.
2. Server ghép từng nhân vật vào cùng 1 prompt cảnh → nội dung giống hệt, chỉ khác nhân vật.
3. Veo (Google) tạo 13 video (mỗi video ~8 giây), chạy song song có giới hạn.

## Chạy

Cần Node.js 20+ và API key Gemini có quyền dùng Veo (https://aistudio.google.com/apikey — Veo là tính năng trả phí).

```bash
npm install
cp .env.example .env   # điền GEMINI_API_KEY
npm start              # mở http://localhost:3000
```

Thử giao diện không tốn tiền (video giả bằng ffmpeg):

```bash
MOCK=1 npm start
```

## Cấu hình (.env)

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `GEMINI_API_KEY` | — | bắt buộc (trừ MOCK) |
| `ANALYZE_MODEL` | `gemini-2.5-flash` | model phân tích video |
| `VEO_MODEL` | `veo-3.1-fast-generate-preview` | đổi sang `veo-3.1-generate-preview` để chất lượng cao hơn (đắt hơn) |
| `CONCURRENCY` | `3` | số video tạo cùng lúc |
| `PORT` | `3000` | |

Video và trạng thái lưu trong thư mục `data/`.

## Lưu ý

- Veo tạo clip tối đa ~8 giây; video gốc dài hơn sẽ được tóm thành 1 cảnh 8 giây.
- Video tạo bằng text-to-video nên khớp concept chứ không giống từng khung hình gốc.
- Một số prompt có thể bị bộ lọc an toàn của Google chặn (vd: trẻ em, người nổi tiếng) — sửa prompt rồi bấm "Tạo lại".

## Deploy lên web (Render)

Repo đã có sẵn `render.yaml`.

1. Vào https://dashboard.render.com → **New** → **Blueprint**, kết nối GitHub và chọn repo này (chọn nhánh chứa code).
2. Render hỏi 2 biến môi trường:
   - `GEMINI_API_KEY`: key Gemini của bạn.
   - `APP_PASSWORD`: mật khẩu vào web (trình duyệt sẽ hỏi; tên đăng nhập gõ gì cũng được).
3. Bấm **Apply** → khoảng 2–3 phút sau bạn có link dạng `https://nuyen-video-gen.onrender.com`.

Gói `starter` (~7 USD/tháng) kèm ổ đĩa 5 GB để giữ video qua các lần khởi động lại. Có thể đổi sang `free` trong `render.yaml` (bỏ phần `disk`), nhưng khi đó server ngủ sau 15 phút không dùng và video cũ sẽ mất (nhớ tải về ngay).

Muốn host ở chỗ khác (Railway, Fly.io, VPS…) thì dùng `Dockerfile` có sẵn.
