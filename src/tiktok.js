// Client tối giản cho TikTok Business API v1.3.
const BASE = process.env.TIKTOK_API_BASE || 'https://business-api.tiktok.com/open_api/v1.3';
const RETRY_CODES = new Set([40100, 40016, 50000, 50002, 51021]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TikTokError extends Error {
  constructor(code, message, requestId) {
    super(`TikTok API ${code}: ${message}`);
    this.code = code;
    this.requestId = requestId;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function createClient({ accessToken, appId, secret }) {
  async function request(method, path, params = {}) {
    if (!accessToken) throw new Error('Chưa cấu hình TIKTOK_ACCESS_TOKEN');
    let url = BASE + path;
    const init = { method, headers: { 'Access-Token': accessToken } };
    if (method === 'GET') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      url += '?' + qs.toString();
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(params);
    }

    for (let attempt = 0; ; attempt++) {
      let json;
      try {
        const res = await fetch(url, init);
        json = await res.json();
      } catch (err) {
        if (attempt < 3) { await sleep(1000 * 2 ** attempt); continue; }
        throw err;
      }
      if (json.code === 0) return json.data || {};
      if (RETRY_CODES.has(json.code) && attempt < 3) { await sleep(1500 * 2 ** attempt); continue; }
      throw new TikTokError(json.code, json.message, json.request_id);
    }
  }

  return {
    request,

    // Ad account được ủy quyền cho access token
    async listAuthorizedAdvertisers() {
      if (!appId || !secret) return [];
      const data = await request('GET', '/oauth2/advertiser/get/', { app_id: appId, secret });
      return (data.list || []).map((a) => ({ advertiser_id: String(a.advertiser_id), name: a.advertiser_name }));
    },

    // Toàn bộ ad account trong một Business Center
    async listBcAdvertisers(bcId) {
      const out = [];
      for (let page = 1; ; page++) {
        const data = await request('GET', '/bc/asset/get/', { bc_id: bcId, asset_type: 'ADVERTISER', page, page_size: 50 });
        for (const a of data.list || []) out.push({ advertiser_id: String(a.asset_id), name: a.asset_name, bc_id: bcId });
        const totalPage = (data.page_info && data.page_info.total_page) || 1;
        if (page >= totalPage) break;
      }
      return out;
    },

    async getAdvertiserInfo(ids) {
      const fields = ['advertiser_id', 'name', 'status', 'rejection_reason', 'company', 'currency', 'balance', 'create_time', 'owner_bc_id', 'country', 'timezone'];
      const out = [];
      for (const part of chunk(ids, 100)) {
        const data = await request('GET', '/advertiser/info/', { advertiser_ids: part, fields });
        out.push(...(data.list || []));
      }
      return out;
    },

    async getAds(advertiserId, { creationStart } = {}) {
      const fields = ['ad_id', 'ad_name', 'adgroup_id', 'adgroup_name', 'campaign_id', 'campaign_name', 'secondary_status',
        'operation_status', 'video_id', 'image_ids', 'ad_text', 'landing_page_url', 'create_time', 'modify_time'];
      const filtering = creationStart ? { creation_filter_start_time: creationStart } : undefined;
      const out = [];
      for (let page = 1; ; page++) {
        const data = await request('GET', '/ad/get/', { advertiser_id: advertiserId, fields, filtering, page, page_size: 1000 });
        out.push(...(data.list || []));
        const totalPage = (data.page_info && data.page_info.total_page) || 1;
        if (page >= totalPage) break;
      }
      return out;
    },

    // Trả về map ad_id -> thông tin duyệt (is_approved, reject_info, appeal_status...)
    async getAdReviewInfo(advertiserId, adIds) {
      const map = {};
      for (const part of chunk(adIds, 100)) {
        const data = await request('GET', '/ad/review_info/', { advertiser_id: advertiserId, ad_ids: part });
        const src = data.ad_review_map || data.ad_review_info || data.list || {};
        if (Array.isArray(src)) for (const r of src) map[String(r.ad_id)] = r;
        else for (const [k, v] of Object.entries(src)) map[String(k)] = v;
      }
      return map;
    },

    async appealAdgroup({ advertiser_id, adgroup_id, ad_id, appeal_reason, attachment_list }) {
      return request('POST', '/adgroup/appeal/', { advertiser_id, adgroup_id, ad_id, appeal_reason, attachment_list });
    },
  };
}

module.exports = { createClient, TikTokError, chunk };
