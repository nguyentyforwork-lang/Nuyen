# Video Variant Studio

Web app: upload 1 video quảng cáo → nhận

- **10 video** cùng concept, cùng hành động/bối cảnh/khung hình, **chỉ đổi nhân vật**
- **3 video riêng**: **Hook** (1–3s đầu giữ chân người xem), **Hero** (cảnh hero sản phẩm), **Promise** (kết quả/lợi ích hứa hẹn)

Mỗi video có nút **Download**, kèm nút tải hết từng nhóm.

## Cách hoạt động

1. `ffmpeg` cắt 6 khung hình từ video gốc.
2. **Claude** (`claude-opus-5-5`) xem các khung hình → tóm tắt concept, đề xuất 10 nhân vật mới và viết prompt Hook/Hero/Promise.
3. **fal.ai**:
   - `fal-ai/flux/dev` tạo ảnh tham chiếu cho từng nhân vật mới
   - `fal-ai/wan/v2.2-14b/animate/replace` thay nhân vật trong video gốc bằng nhân vật mới (giữ nguyên chuyển động, bối cảnh)
   - `fal-ai/kling-video/v2.1/master/text-to-video` gen 3 video Hook/Hero/Promise
4. File kết quả lưu ở `outputs/<job-id>/`.

Có thể đổi model fal qua `.env` (`FAL_SWAP_MODEL`, `FAL_T2V_MODEL`, `FAL_IMAGE_MODEL`).

## Chạy

```bash
npm install
cp .env.example .env   # điền ANTHROPIC_API_KEY và FAL_KEY
npm start              # http://localhost:3000
```

Test giao diện không tốn tiền (không gọi API, trả lại chính video gốc):

```bash
npm run mock
```

## Lưu ý

- TikTok MCP là API quảng cáo TikTok (upload video, tạo ad, báo cáo…), **không có chức năng tạo video / đổi nhân vật**, nên việc gen video dùng fal.ai. Sau khi có video, có thể upload lên tài khoản TikTok Ads qua TikTok MCP.
- Chi phí: mỗi lần chạy = 1 lần gọi Claude + 10 ảnh + 10 video swap + 3 video text-to-video trên fal.ai.
- Job lưu trong bộ nhớ: restart server sẽ mất trạng thái job (file trong `outputs/` vẫn còn).
