// Logic quét account bị suspend, quét creative bị từ chối và gửi appeal.
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

function createScanner({ client, store, env = process.env, log = console }) {
  const lookbackDays = Number(env.CREATIVE_LOOKBACK_DAYS || 90);
  let running = null;

  const exclusive = (name, fn) => async (...args) => {
    if (running) throw Object.assign(new Error(`Đang chạy "${running}", vui lòng đợi`), { status: 409 });
    running = name;
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

  async function scanAccountsImpl() {
    const now = new Date().toISOString();
    const db = store.db;
    const advertisers = await collectAdvertisers();
    const infos = await client.getAdvertiserInfo(advertisers.map((a) => a.advertiser_id));
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
        newlySuspended++;
      } else if (!suspended && prev && prev.suspended) {
        acc.suspended = false;
        acc.reactivated_at = now;
      } else {
        acc.suspended = suspended;
      }
      db.accounts[id] = acc;
    }

    const result = { type: 'accounts', at: now, total: infos.length, suspended: Object.values(db.accounts).filter((a) => a.suspended).length, newlySuspended };
    db.scans = [result, ...db.scans].slice(0, 200);
    store.save();
    return result;
  }

  async function scanCreativesImpl({ advertiserIds } = {}) {
    const now = new Date().toISOString();
    const db = store.db;
    if (!Object.keys(db.accounts).length) await scanAccountsImpl();
    const ids = advertiserIds && advertiserIds.length ? advertiserIds : Object.keys(db.accounts);
    const creationStart = lookbackDays > 0
      ? new Date(Date.now() - lookbackDays * 86400000).toISOString().replace('T', ' ').slice(0, 19)
      : undefined;
    const errors = [];
    let found = 0, newRejected = 0;

    for (const advId of ids) {
      try {
        const ads = await client.getAds(advId, { creationStart });
        const rejected = ads.filter((ad) => REJECTED_RE.test(ad.secondary_status || ''));
        let reviews = {};
        if (rejected.length) {
          try { reviews = await client.getAdReviewInfo(advId, rejected.map((a) => String(a.ad_id))); }
          catch (err) { errors.push({ advertiser_id: advId, step: 'review_info', error: err.message }); }
        }
        const stillRejected = new Set();
        for (const ad of rejected) {
          const adId = String(ad.ad_id);
          const review = reviews[adId] || {};
          if (review.is_approved === true) continue;
          stillRejected.add(adId);
          const prev = db.creatives[adId];
          if (!prev || prev.state !== 'rejected') newRejected++;
          db.creatives[adId] = {
            appeals: [],
            ...(prev || {}),
            ad_id: adId,
            advertiser_id: advId,
            advertiser_name: db.accounts[advId] ? db.accounts[advId].name : advId,
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
            appeal_status: review.appeal_status,
            reject_reasons: rejectReasons(review),
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
      } catch (err) {
        errors.push({ advertiser_id: advId, step: 'ad_get', error: err.message });
      }
    }

    const result = { type: 'creatives', at: now, accounts: ids.length, rejected: found, newRejected, errors };
    db.scans = [result, ...db.scans].slice(0, 200);
    store.save();
    return result;
  }

  async function appealImpl(adIds, { reason, auto = false } = {}) {
    const db = store.db;
    const appealReason = (reason || db.settings.appealReason || '').trim();
    const results = [];
    for (const adId of adIds) {
      const c = db.creatives[adId];
      if (!c) { results.push({ ad_id: adId, ok: false, error: 'Không tìm thấy creative' }); continue; }
      const entry = { at: new Date().toISOString(), auto, reason: appealReason };
      try {
        await client.appealAdgroup({ advertiser_id: c.advertiser_id, adgroup_id: c.adgroup_id, ad_id: c.ad_id, appeal_reason: appealReason });
        entry.ok = true;
        c.appeal_status = 'APPEALING';
      } catch (err) {
        entry.ok = false;
        entry.error = err.message;
      }
      c.appeals = [...(c.appeals || []), entry];
      db.appealLog = [{ ad_id: adId, advertiser_id: c.advertiser_id, ad_name: c.ad_name, ...entry }, ...db.appealLog].slice(0, 2000);
      results.push({ ad_id: adId, ...entry });
      store.save();
      await sleep(300);
    }
    return { total: results.length, ok: results.filter((r) => r.ok).length, results };
  }

  function autoAppealCandidates() {
    const { settings, creatives } = store.db;
    return Object.values(creatives)
      .filter((c) => c.state === 'rejected')
      .filter((c) => !APPEAL_PENDING_RE.test(c.appeal_status || ''))
      .filter((c) => (c.appeals || []).filter((a) => a.ok).length < settings.maxAppealsPerAd)
      .sort((a, b) => a.detected_at.localeCompare(b.detected_at))
      .slice(0, settings.maxAppealsPerRun)
      .map((c) => c.ad_id);
  }

  async function fullScanImpl() {
    const accounts = await scanAccountsImpl();
    const creatives = await scanCreativesImpl();
    let appeals = null;
    if (store.db.settings.autoAppeal) {
      const ids = autoAppealCandidates();
      if (ids.length) appeals = await appealImpl(ids, { auto: true });
    }
    log.info(`[scan] accounts=${accounts.total} suspended=${accounts.suspended} rejected=${creatives.rejected} appealed=${appeals ? appeals.ok : 0}`);
    return { accounts, creatives, appeals };
  }

  return {
    scanAccounts: exclusive('quét account', scanAccountsImpl),
    scanCreatives: exclusive('quét creative', scanCreativesImpl),
    appeal: exclusive('appeal', appealImpl),
    fullScan: exclusive('quét toàn bộ', fullScanImpl),
    autoAppealCandidates,
    get running() { return running; },
  };
}

module.exports = { createScanner, SUSPENDED, REJECTED_RE };
