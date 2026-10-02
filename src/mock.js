// Client giả lập để chạy thử giao diện mà không cần token TikTok (MOCK=1).
const STATUSES = ['STATUS_ENABLE', 'STATUS_ENABLE', 'STATUS_ENABLE', 'STATUS_LIMIT', 'STATUS_DISABLE'];
const REASONS = ['Misleading claims', 'Prohibited products: weapons', 'Low quality landing page', 'Unrealistic results'];

function createMockClient() {
  const accounts = Array.from({ length: 12 }, (_, i) => ({ advertiser_id: String(7300000000000000000n + BigInt(i)), name: `Ecom Acc ${i + 1}` }));
  const appealed = new Set();
  let tick = 0;

  return {
    async listAuthorizedAdvertisers() { return accounts; },
    async listBcAdvertisers() { return []; },
    async getAdvertiserInfo(ids) {
      tick++;
      return ids.map((id, i) => {
        // Mỗi lần quét có thể có thêm account bị suspend để thấy được lọc theo ngày
        const status = i < tick ? STATUSES[(i * 7 + tick) % STATUSES.length] : 'STATUS_ENABLE';
        return {
          advertiser_id: id, name: accounts[i] ? accounts[i].name : id, status,
          rejection_reason: status === 'STATUS_ENABLE' ? '' : REASONS[i % REASONS.length],
          company: 'Ecomdy Media', currency: 'USD', balance: (i * 37.5).toFixed(2), create_time: 1700000000 + i * 86400,
        };
      });
    },
    async getAds(advertiserId) {
      const seed = Number(BigInt(advertiserId) % 100n);
      return Array.from({ length: 6 }, (_, j) => ({
        ad_id: `${advertiserId}${j}`, ad_name: `Creative ${seed}-${j}`, adgroup_id: `${advertiserId}9${j}`,
        adgroup_name: `Adgroup ${j}`, campaign_id: `${advertiserId}8`, campaign_name: `Campaign ${seed}`,
        secondary_status: (seed + j) % 3 === 0 && !appealed.has(`${advertiserId}${j}`) ? 'AD_STATUS_AUDIT_DENY' : 'AD_STATUS_DELIVERY_OK',
        video_id: `v09044g40000${seed}${j}`, ad_text: 'Sale 50% hôm nay', landing_page_url: 'https://example.com',
        create_time: '2026-09-20 10:00:00', modify_time: '2026-10-01 08:00:00',
      }));
    },
    async getAdReviewInfo(advertiserId, adIds) {
      const map = {};
      for (const id of adIds) {
        map[id] = {
          ad_id: id, is_approved: false, appeal_status: appealed.has(id) ? 'APPEALING' : 'NOT_APPEALED',
          reject_info: [{ reason: REASONS[Number(BigInt(id) % 4n)], suggestion: 'Chỉnh sửa nội dung theo chính sách quảng cáo' }],
        };
      }
      return map;
    },
    async appealAdgroup({ ad_id }) { appealed.add(ad_id); return {}; },
  };
}

module.exports = { createMockClient };
