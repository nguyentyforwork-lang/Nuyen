# Face Swap Studio

Web app: tải video lên → viết prompt để tạo **khuôn mặt AI** (sửa prompt và tạo lại bao nhiêu lần cũng được) → ghép mặt AI đó vào video.

## Chạy

```bash
npm install
cp .env.example .env   # điền REPLICATE_API_TOKEN
npm start              # mở http://localhost:3000
```

Chưa có token thì app chạy **chế độ DEMO** để thử giao diện (ảnh mặt giả, video trả về là video gốc).

## Cách hoạt động

1. **Video gốc** – kéo thả video (≤ 200MB).
2. **Mặt AI** – nhập prompt mô tả khuôn mặt (tuổi, giới tính, tóc, biểu cảm…), bấm *Tạo mặt AI*.
   Có các nút gợi ý (+ tóc ngắn, + đeo kính…) để thêm nhanh vào prompt. Mọi lần tạo được lưu ở dãy ảnh nhỏ để chọn lại.
   Server tự nối thêm đoạn "chân dung chính diện, ánh sáng đều…" để mặt dễ ghép hơn (xem trong *Prompt đầy đủ*).
   Có thể tải ảnh mặt của bạn thay cho mặt AI.
3. **Kết quả** – tick xác nhận quyền sử dụng, bấm *Ghép mặt vào video*, chờ rồi tải về.

## Model (đổi trong `.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FACE_MODEL` | `black-forest-labs/flux-schnell` | Tạo ảnh mặt từ prompt |
| `SWAP_MODEL` | `arabyai-replicate/roop_face_swap` | Ghép mặt vào video |
| `SWAP_FACE_KEY` / `SWAP_VIDEO_KEY` | `swap_image` / `target_video` | Tên input của model ghép mặt |

Muốn dùng model ghép mặt khác trên Replicate: đổi `SWAP_MODEL` (có thể ghi `owner/name:version`) và 2 tên input theo trang model đó.

## Lưu ý sử dụng

Chỉ dùng với video bạn có quyền sử dụng, không dùng để mạo danh người thật, và ghi rõ nội dung do AI tạo khi đăng (TikTok/Meta đều yêu cầu gắn nhãn nội dung AI).
