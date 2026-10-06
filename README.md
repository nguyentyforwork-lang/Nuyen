# Nuyen — Suspension Checker

Web tool: upload file suspension list (ví dụ `Ecomdy - Q3 Suspension list (data only).xlsx`) → tra cứu qua TikTok Business API:

| Cột | Nguồn |
|---|---|
| Advertiser ID, Agency, Ngày sus | Từ file (`advertiser_id`, `agent_account_name`, `latest_punish_begin_time`) |
| Tên ad account, BC (`owner_bc_id` + tên BC) | `GET /advertiser/info/`, `GET /bc/get/` |
| Trạng thái | `status` của advertiser: `STATUS_LIMIT` = **Đang sus**, `STATUS_ENABLE` = **Approved (đã gỡ)** |
| Ngày gỡ | Lấy từ file nếu có cột kiểu `punish_end_time` / `unpunish_time`. Nếu không, tool ghi lại ngày **đầu tiên** check thấy account không còn sus (hiển thị kèm "(ghi nhận)") |

Lọc theo: ID / tên (dán nhiều ID cùng lúc), trạng thái, BC, agency, khoảng ngày sus. Bấm các ô thống kê để lọc nhanh. Có nút **Xuất Excel** cho kết quả đang lọc.

## Chạy

Cần Node.js ≥ 18, không cần cài thêm package.

```bash
# Cách 1: nhập token trên giao diện
npm start

# Cách 2: để token phía server (không phải nhập trên web)
TIKTOK_ACCESS_TOKEN=xxxxx npm start
```

Mở http://localhost:3000.

**Access Token** phải là token của agency/BC có quyền với các ad account trong file (TikTok Business API app có scope Ad Account Management + Business Center). Account nào token không có quyền sẽ báo "Token không có quyền với account này".

## Lưu ý

- TikTok API không trả về ngày gỡ sus, nên "Ngày gỡ (ghi nhận)" chỉ là ngày tool phát hiện. Check định kỳ (vd. mỗi ngày) để ngày ghi nhận sát thực tế. Lịch sử lưu ở `data/history.json`.
- Mỗi lần gọi `/advertiser/info/` tra tối đa 100 ID; file ~4.300 dòng mất khoảng 1 phút.

## Bản web trên claude.ai

`artifact/sus-tracker.html` là bản chạy trên claude.ai (https://claude.ai/artifact/SPWy62soL2pxHWzwEqJioY). Bản này không cần server. Nguồn chính là connector **Ecomdy Data Center** (trạng thái, tên, BC, spend theo ngày); connector **TikTok MCP** dùng để bù account ngoài phạm vi Data Center và đối chiếu trạng thái. Mỗi dòng có cột Nguồn và Ghi chú lỗi. Trang lưu "ngày gỡ (ghi nhận)" chung cho mọi người dùng trang.
