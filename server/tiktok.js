// Minimal TikTok Business API (v1.3) client with retry + pagination helpers.
const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

// Codes TikTok returns when throttled / transient.
const RETRYABLE = new Set([40100, 40133, 50000, 50002, 51021, 61000]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TikTokError extends Error {
  constructor(code, message, path) {
    super(`[TikTok ${code}] ${message} (${path})`);
    this.code = code;
  }
}

function createClient(accessToken) {
  async function get(path, params = {}, attempt = 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { 'Access-Token': accessToken },
    });
    let body;
    try {
      body = await res.json();
    } catch {
      body = { code: res.status, message: res.statusText };
    }
    if (body.code === 0) return body.data;
    if ((RETRYABLE.has(body.code) || res.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return get(path, params, attempt + 1);
    }
    throw new TikTokError(body.code, body.message, path);
  }

  // Generic page-number pagination. `listKey` is the array key inside data.
  async function getAll(path, params, listKey = 'list', pageSize = 1000, maxPages = 50) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await get(path, { ...params, page, page_size: pageSize });
      const list = data[listKey] || [];
      out.push(...list);
      const totalPage = data.page_info?.total_page ?? 1;
      if (page >= totalPage || list.length === 0) break;
    }
    return out;
  }

  // Synchronous integrated report, flattened to {...dimensions, ...metrics}.
  async function report(params, { stopWhenZeroSpend = false } = {}) {
    const out = [];
    for (let page = 1; page <= 50; page++) {
      const data = await get('/report/integrated/get/', {
        report_type: 'BASIC',
        service_type: 'AUCTION',
        ...params,
        page,
        page_size: 1000,
      });
      const list = (data.list || []).map((r) => ({ ...r.dimensions, ...r.metrics }));
      out.push(...list);
      // Results are ordered by spend DESC when requested, so we can stop early.
      if (stopWhenZeroSpend && list.length && Number(list[list.length - 1].spend) === 0) break;
      if (page >= (data.page_info?.total_page ?? 1) || list.length === 0) break;
    }
    return stopWhenZeroSpend ? out.filter((r) => Number(r.spend) > 0) : out;
  }

  return { get, getAll, report };
}

module.exports = { createClient, TikTokError };
