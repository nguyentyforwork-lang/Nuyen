// Client giả lập để chạy thử giao diện mà không cần token TikTok (MOCK=1).
const REASONS = ['Misleading claims', 'Prohibited products: weight loss supplement', 'Landing page is not functional', 'Unrealistic results', 'Low quality video'];

function createMockClient() {
  const accounts = Array.from({ length: 14 }, (_, i) => ({ advertiser_id: String(7300000000000000000n + BigInt(i)), name: `Ecom Acc ${i + 1}` }));
  const status = {};
  const appealed = new Set();
  let tick = 0;
  const violating = (adId) => Number(BigInt(adId) % 7n) < 2; // ~2/7 ad vi phạm

  return {
    async listAuthorizedAdvertisers() { return accounts; },
    async listBcAdvertisers() { return []; },
    async getAdvertiserInfo(ids) {
      tick++;
      return ids.map((id, i) => {
        // Lần quét 1: vài account đã bị khoá sẵn; lần quét sau: thêm account mới bị khoá
        let s = 'STATUS_ENABLE';
        if (i % 4 === 1) s = 'STATUS_LIMIT';
        if (tick >= 2 && i % 5 === 3) s = 'STATUS_DISABLE';
        status[id] = s;
        return {
          advertiser_id: id, name: accounts[i] ? accounts[i].name : id, status: s,
          rejection_reason: s === 'STATUS_ENABLE' ? '' : ['Violation of advertising policies', 'Unpaid balance / suspicious payment', 'Repeated policy violations'][i % 3],
          company: 'Ecomdy Media', currency: 'USD', balance: (i * 37.5).toFixed(2), create_time: 1700000000 + i * 86400,
        };
      });
    },
    async getAds(advertiserId) {
      const seed = Number(BigInt(advertiserId) % 100n);
      return Array.from({ length: 7 }, (_, j) => {
        const adId = `${advertiserId}${j}`;
        const punished = status[advertiserId] && status[advertiserId] !== 'STATUS_ENABLE';
        return {
          ad_id: adId, ad_name: `Creative ${seed}-${j}`, adgroup_id: `${advertiserId}9${j}`,
          adgroup_name: `Adgroup ${j}`, campaign_id: `${advertiserId}8`, campaign_name: `Campaign ${seed}`,
          secondary_status: punished ? 'ADVERTISER_ACCOUNT_PUNISH' : violating(adId) ? 'AD_STATUS_AUDIT_DENY' : 'AD_STATUS_DELIVERY_OK',
          video_id: `v09044g40000${seed}${j}`, ad_text: 'Sale 50% hôm nay', landing_page_url: 'https://example.com',
          create_time: '2026-09-20 10:00:00', modify_time: '2026-10-01 08:00:00',
        };
      });
    },
    async getAdReviewInfo(advertiserId, adIds) {
      const map = {};
      for (const id of adIds) {
        const bad = violating(id);
        map[id] = {
          ad_id: id, is_approved: !bad, appeal_status: appealed.has(id) ? 'APPEALING' : 'NOT_APPEALED',
          reject_info: bad ? [{ reason: REASONS[Number(BigInt(id) % 5n)], suggestion: 'Chỉnh sửa nội dung theo chính sách quảng cáo' }] : [],
        };
      }
      return map;
    },
    async appealAdgroup({ ad_id }) {
      if (Number(BigInt(ad_id) % 11n) === 0) throw new Error('TikTok API 40002: Appeal times exceeded'); // giả lập lỗi thỉnh thoảng
      appealed.add(ad_id);
      return {};
    },
  };
}

module.exports = { createMockClient };
