// Logic quét account bị suspend, kiểm tra creative vi phạm và gửi appeal.
const crypto = require('crypto');
const { render, matchTemplate, creativeVars } = require('./templates');

const SUSPENDED = new Set(['STATUS_LIMIT', 'STATUS_DISABLE', 'STATUS_CONFIRM_FAIL', 'STATUS_CONFIRM_FAIL_END']);
const REJECTED_RE = /AUDIT_DENY|REJECT|NOT_APPROVED|PARTIAL_AUDIT/;
const APPEAL_PENDING_RE = /APPEALING|IN_REVIEW|PROCESSING|PENDING/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rejectReasons(review) {
  const info = review && review.reject_info;
  if (!info) return [];
  return (Array.isArray(info) ? info : [info]).map((r) => ({
    reason: r.reason || r.reject_reason || '',
    suggestion: r.suggestion || '',
    content_type: r.content_type || r.reject_content_type || '',
  }));
}

const okAppeals = (c) => (c.appeals || []).filter((a) => a.ok);
const isAppealPending = (c) => APPEAL_PENDING_RE.test(c.appeal_status || '');

// Trạng thái appeal gộp của 1 creative: none | pending | failed | sent
function appealState(c) {
  if (isAppealPending(c)) return 'pending';
  const last = (c.appeals || []).at(-1);
  if (last && !last.ok) return 'failed';
  if (/FAIL|REJECT/i.test(c.appeal_status || '')) return 'failed';
  return okAppeals(c).length ? 'sent' : 'none';
}

function createScanner({ client, store, env = process.env, log = console, appealDelayMs = 300 }) {
  const lookbackDays = Number(env.CREATIVE_LOOKBACK_DAYS || 90);
  let running = null;
  let job = null;

  const lock = (name) => {
    if (running) throw Object.assign(new Error(`Đang chạy "${running}", vui lòng đợi`), { status: 409 });
    running = name;
  };
  const exclusive = (name, fn) => async (...args) => {
    lock(name);
    try { return await fn(...args); } finally { running = null; }
  };

  async function collectAdvertisers() {
    const map = new Map();
    const add = (a) => { if (!map.has(a.advertiser_id)) map.set(a.advertiser_id, a); };
    (await client.listAuthorizedAdvertisers()).forEach(add);
    for (const bc of (env.TIKTOK_BC_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      (await client.listBcAdvertisers(bc)).forEach(add);
    }
    for (const id of (env.TIKTOK_ADVERTISER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      add({ advertiser_id: id, name: id });
    }
    return [...map.values()];
  }

  // advertiserIds: chỉ cập nhật trạng thái các account này (mặc định: toàn bộ account)
  async function scanAccountsImpl({ advertiserIds } = {}) {
    const now = new Date().toISOString();
    const db = store.db;
    const ids = advertiserIds && advertiserIds.length
      ? advertiserIds.map(String)
      : (await collectAdvertisers()).map((a) => a.advertiser_id);
    const infos = await client.getAdvertiserInfo(ids);
    let newlySuspended = 0;

    for (const info of infos) {
      const id = String(info.advertiser_id);
      const prev = db.accounts[id];
      const suspended = SUSPENDED.has(info.status);
      const acc = {
        ...(prev || { first_seen: now, history: [] }),
        advertiser_id: id,
        name: info.name,
        status: info.status,
        rejection_reason: info.rejection_reason || '',
        company: info.company,
        currency: info.currency,
        balance: info.balance,
        owner_bc_id: info.owner_bc_id,
        create_time: info.create_time,
        last_checked: now,
      };
      if (!prev || prev.status !== info.status) acc.history = [...(acc.history || []), { status: info.status, at: now }];

      if (suspended && !(prev && prev.suspended)) {
        acc.suspended = true;
        acc.suspended_at = now;
        // Lần đầu thấy account đã bị suspend sẵn => không biết chính xác ngày, đánh dấu ước lượng
        acc.suspended_at_estimated = !prev;
        acc.reactivated_at = null;
        acc.account_appealed_at = null;
        newlySuspended++;
      } else if (!suspended && prev && prev.suspended) {
        acc.suspended = false;
        acc.reactivated_at = now;
      } else {
        acc.suspended = suspended;
      }
      db.accounts[id] = acc;
    }

    const result = { type: 'accounts', at: now, total: infos.length, partial: !!(advertiserIds && advertiserIds.length), suspended: Object.values(db.accounts).filter((a) => a.suspended).length, newlySuspended };
    db.scans = [result, ...db.scans].slice(0, 200);
    store.save();
    return result;
  }

  async function scanCreativesImpl({ advertiserIds } = {}) {
    const now = new Date().toISOString();
    const db = store.db;
    if (!Object.keys(db.accounts).length) await scanAccountsImpl();
    const ids = advertiserIds && advertiserIds.length ? advertiserIds.map(String) : Object.keys(db.accounts);
    const creationStart = lookbackDays > 0
      ? new Date(Date.now() - lookbackDays * 86400000).toISOString().replace('T', ' ').slice(0, 19)
      : undefined;
    const errors = [];
    let found = 0, newRejected = 0;

    for (const advId of ids) {
      const account = db.accounts[advId];
      try {
        const ads = await client.getAds(advId, { creationStart });
        // Account bị suspend: secondary_status của ad bị che (ADVERTISER_ACCOUNT_PUNISH),
        // nên phải hỏi review_info cho TẤT CẢ ad để biết ad nào thực sự vi phạm.
        const deep = !!(account && account.suspended);
        const candidates = deep ? ads : ads.filter((ad) => REJECTED_RE.test(ad.secondary_status || ''));
        let reviews = {};
        if (candidates.length) {
          try { reviews = await client.getAdReviewInfo(advId, candidates.map((a) => String(a.ad_id))); }
          catch (err) { errors.push({ advertiser_id: advId, step: 'review_info', error: err.message }); }
        }
        const stillRejected = new Set();
        for (const ad of candidates) {
          const adId = String(ad.ad_id);
          const review = reviews[adId] || {};
          const rejected = typeof review.is_approved === 'boolean' ? !review.is_approved : REJECTED_RE.test(ad.secondary_status || '');
          if (!rejected) continue;
          stillRejected.add(adId);
          const prev = db.creatives[adId];
          if (!prev || prev.state !== 'rejected') newRejected++;
          db.creatives[adId] = {
            appeals: [],
            ...(prev || {}),
            ad_id: adId,
            advertiser_id: advId,
            advertiser_name: account ? account.name : advId,
            ad_name: ad.ad_name,
            adgroup_id: String(ad.adgroup_id),
            adgroup_name: ad.adgroup_name,
            campaign_id: String(ad.campaign_id),
            campaign_name: ad.campaign_name,
            secondary_status: ad.secondary_status,
            video_id: ad.video_id,
            image_ids: ad.image_ids,
            ad_text: ad.ad_text,
            landing_page_url: ad.landing_page_url,
            create_time: ad.create_time,
            modify_time: ad.modify_time,
            review_status: review.review_status,
            appeal_status: review.appeal_status || (prev && prev.appeal_status),
            reject_reasons: rejectReasons(review).length ? rejectReasons(review) : (prev && prev.reject_reasons) || [],
            state: 'rejected',
            detected_at: prev && prev.state === 'rejected' ? prev.detected_at : now,
            resolved_at: null,
            last_checked: now,
          };
        }
        found += stillRejected.size;
        // Creative trước đây bị từ chối nhưng giờ không còn => đã được duyệt lại / đã xoá
        for (const c of Object.values(db.creatives)) {
          if (c.advertiser_id === advId && c.state === 'rejected' && !stillRejected.has(c.ad_id)) {
            c.state = 'resolved';
            c.resolved_at = now;
          }
        }
        if (account) account.creatives_checked_at = now;
      } catch (err) {
        errors.push({ advertiser_id: advId, step: 'ad_get', error: err.message });
      }
    }

    const result = { type: 'creatives', at: now, accounts: ids.length, rejected: found, newRejected, errors };
    db.scans = [result, ...db.scans].slice(0, 200);
    store.save();
    return result;
  }

  // ===== Appeal =====

  // Dựng danh sách appeal: mỗi creative 1 dòng với nội dung đã render từ template
  function buildAppealPlan({ advertiserIds, adIds, templateId = 'auto', text, skipAppealed = true } = {}) {
    const db = store.db;
    const { templates, settings } = db;
    const advSet = advertiserIds && advertiserIds.length ? new Set(advertiserIds.map(String)) : null;
    const adSet = adIds && adIds.length ? new Set(adIds.map(String)) : null;
    if (!advSet && !adSet) throw Object.assign(new Error('Chưa chọn account hoặc creative'), { status: 400 });
    const fixed = templateId !== 'auto' && !text ? templates.find((t) => t.id === templateId) : null;
    if (templateId !== 'auto' && !text && !fixed) throw Object.assign(new Error('Không tìm thấy template'), { status: 400 });

    const items = [], skipped = [];
    for (const c of Object.values(db.creatives)) {
      if (c.state !== 'rejected') continue;
      if (adSet ? !adSet.has(c.ad_id) : !advSet.has(c.advertiser_id)) continue;
      const st = appealState(c);
      if (skipAppealed && (st === 'pending' || st === 'sent')) { skipped.push({ ad_id: c.ad_id, ad_name: c.ad_name, advertiser_id: c.advertiser_id, why: st === 'pending' ? 'Đang được xét appeal' : 'Đã appeal' }); continue; }
      const tpl = text ? { id: 'custom', name: 'Tuỳ chỉnh', text } : fixed || matchTemplate(templates, (c.reject_reasons || []).map((r) => r.reason), settings.defaultTemplateId);
      items.push({
        ad_id: c.ad_id, ad_name: c.ad_name, advertiser_id: c.advertiser_id, advertiser_name: c.advertiser_name, adgroup_id: c.adgroup_id,
        template_id: tpl.id, template_name: tpl.name, reason: render(tpl.text, creativeVars(c, db.accounts[c.advertiser_id])).slice(0, 1000),
      });
    }
    return { items, skipped, accounts: new Set(items.map((i) => i.advertiser_id)).size };
  }

  async function runAppeals(items, { auto = false, onProgress = () => {} } = {}) {
    const db = store.db;
    const results = [];
    for (const it of items) {
      const c = db.creatives[it.ad_id];
      const entry = { at: new Date().toISOString(), auto, reason: it.reason, template_id: it.template_id };
      try {
        await client.appealAdgroup({ advertiser_id: c.advertiser_id, adgroup_id: c.adgroup_id, ad_id: c.ad_id, appeal_reason: it.reason });
        entry.ok = true;
        c.appeal_status = 'APPEALING';
      } catch (err) {
        entry.ok = false;
        entry.error = err.message;
      }
      c.appeals = [...(c.appeals || []), entry];
      db.appealLog = [{ ad_id: c.ad_id, advertiser_id: c.advertiser_id, advertiser_name: c.advertiser_name, ad_name: c.ad_name, template_name: it.template_name, ...entry }, ...db.appealLog].slice(0, 5000);
      results.push({ ad_id: c.ad_id, advertiser_id: c.advertiser_id, ok: entry.ok, error: entry.error });
      store.save();
      onProgress(entry);
      if (appealDelayMs) await sleep(appealDelayMs);
    }
    return { total: results.length, ok: results.filter((r) => r.ok).length, results };
  }

  // Bulk appeal chạy nền, trả về job để UI theo dõi tiến độ
  function startAppealJob(planOpts) {
    const plan = buildAppealPlan(planOpts);
    if (!plan.items.length) throw Object.assign(new Error('Không có creative nào cần appeal'), { status: 400 });
    lock('bulk appeal');
    job = {
      id: crypto.randomBytes(6).toString('hex'), status: 'running', startedAt: new Date().toISOString(),
      total: plan.items.length, accounts: plan.accounts, skipped: plan.skipped.length, done: 0, ok: 0, failed: 0, errors: [],
    };
    const current = job;
    runAppeals(plan.items, {
      onProgress: (e) => { current.done++; e.ok ? current.ok++ : (current.failed++, current.errors.push(e.error)); },
    })
      .catch((err) => { current.errors.push(err.message); })
      .finally(() => { current.status = 'done'; current.finishedAt = new Date().toISOString(); current.errors = current.errors.slice(0, 50); running = null; });
    return current;
  }

  function autoAppealPlan() {
    const { settings, creatives, accounts } = store.db;
    const scope = settings.autoAppealScope || 'all';
    const ids = Object.values(creatives)
      .filter((c) => c.state === 'rejected' && !isAppealPending(c))
      .filter((c) => okAppeals(c).length < settings.maxAppealsPerAd)
      .filter((c) => {
        const susp = !!(accounts[c.advertiser_id] && accounts[c.advertiser_id].suspended);
        return scope === 'all' || (scope === 'suspended' ? susp : !susp);
      })
      .sort((a, b) => a.detected_at.localeCompare(b.detected_at))
      .slice(0, settings.maxAppealsPerRun)
      .map((c) => c.ad_id);
    return ids.length ? buildAppealPlan({ adIds: ids, templateId: 'auto', skipAppealed: false }).items : [];
  }

  async function fullScanImpl() {
    const accounts = await scanAccountsImpl();
    const creatives = await scanCreativesImpl();
    let appeals = null;
    if (store.db.settings.autoAppeal) {
      const items = autoAppealPlan();
      if (items.length) appeals = await runAppeals(items, { auto: true });
    }
    log.info(`[scan] accounts=${accounts.total} suspended=${accounts.suspended} rejected=${creatives.rejected} appealed=${appeals ? appeals.ok : 0}`);
    return { accounts, creatives, appeals };
  }

  return {
    scanAccounts: exclusive('quét account', scanAccountsImpl),
    scanCreatives: exclusive('kiểm tra creative', scanCreativesImpl),
    fullScan: exclusive('quét toàn bộ', fullScanImpl),
    buildAppealPlan,
    startAppealJob,
    autoAppealPlan,
    get job() { return job; },
    get running() { return running; },
  };
}

module.exports = { createScanner, SUSPENDED, REJECTED_RE, appealState };
