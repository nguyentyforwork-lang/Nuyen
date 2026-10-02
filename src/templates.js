// Template lý do appeal. Biến dùng được: {ad_name} {ad_id} {advertiser_id} {advertiser_name} {company} {reason}
const crypto = require('crypto');

const ACCOUNT_TEXT = `My account was suspended, and we believe this may be a mistake. The ad video is only used to demonstrate the app’s features and does not contain any prohibited content.
This suspension is affecting our ability to scale, as we were preparing to increase spend to $7k–$10k daily. We would greatly appreciate a prompt review so we can continue advertising.
Thank you for your time and support.`;

const CAMPAIGN_FLAG_TEXT = `My campaign was wrongly flag, and we believe this may be a mistake. The ad video is only used to demonstrate the app’s features and does not contain any prohibited content.
This wrongly flag is affecting our ability to scale, as we were preparing to increase spend to $7k–$10k daily. We would greatly appreciate a prompt review so we can continue advertising.
Thank you for your time and support.`;

const TEMPLATES_VERSION = 2;
const DEFAULT_TEMPLATES = [
  { id: 'creative-default', kind: 'creative', name: 'Campaign / creative bị flag', keywords: [], text: CAMPAIGN_FLAG_TEXT },
  { id: 'account-default', kind: 'account', name: 'Appeal account bị suspend', keywords: [], text: ACCOUNT_TEXT },
];
// Template có sẵn của bản cũ, bị thay thế khi nâng cấp lên TEMPLATES_VERSION 2
const LEGACY_BUILTIN_IDS = ['creative-misleading', 'creative-landing', 'creative-prohibited', 'creative-ip', 'creative-quality', 'creative-adult'];

function newId() { return 'tpl-' + crypto.randomBytes(4).toString('hex'); }

function render(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null || vars[k] === '' ? (k === 'reason' ? 'policy violation' : '') : String(vars[k])));
}

// Chọn template creative khớp nhất với lý do vi phạm; không khớp => template mặc định
function matchTemplate(templates, reasons, fallbackId) {
  const creative = templates.filter((t) => t.kind === 'creative');
  const text = (reasons || []).join(' ').toLowerCase();
  if (text) {
    for (const t of creative) {
      if ((t.keywords || []).some((k) => k && text.includes(k.toLowerCase()))) return t;
    }
  }
  return creative.find((t) => t.id === fallbackId) || creative.find((t) => !(t.keywords || []).length) || creative[0];
}

function creativeVars(c, account) {
  return {
    ad_name: c.ad_name, ad_id: c.ad_id, advertiser_id: c.advertiser_id, advertiser_name: c.advertiser_name,
    company: account && account.company, reason: (c.reject_reasons || []).map((r) => r.reason).filter(Boolean).join('; '),
  };
}

function accountVars(a) {
  return { advertiser_id: a.advertiser_id, advertiser_name: a.name, company: a.company, reason: a.rejection_reason };
}

module.exports = { DEFAULT_TEMPLATES, TEMPLATES_VERSION, LEGACY_BUILTIN_IDS, render, matchTemplate, creativeVars, accountVars, newId };
