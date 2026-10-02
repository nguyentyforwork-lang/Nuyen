// Template lý do appeal. Biến dùng được: {ad_name} {ad_id} {advertiser_id} {advertiser_name} {company} {reason}
const crypto = require('crypto');

const DEFAULT_TEMPLATES = [
  {
    id: 'creative-default', kind: 'creative', name: 'Mặc định (creative)', keywords: [],
    text: 'Hello TikTok Ads Review Team, we kindly request a re-review of our ad "{ad_name}" (Ad ID: {ad_id}, Advertiser ID: {advertiser_id}). We believe this ad complies with TikTok Advertising Policies: it accurately represents our product, contains no prohibited or misleading content, and the landing page matches the ad. If any specific element needs to be changed, please let us know and we will update it promptly. Thank you.',
  },
  {
    id: 'creative-misleading', kind: 'creative', name: 'Misleading / exaggerated claims',
    keywords: ['misleading', 'exaggerat', 'unrealistic', 'false', 'claim', 'before and after', 'guarantee'],
    text: 'Hello TikTok Ads Review Team, our ad "{ad_name}" (Ad ID: {ad_id}) was rejected for: {reason}. The ad does not make guaranteed, exaggerated or unrealistic claims; all statements describe real product features and our offer is clearly stated on the landing page. We kindly ask for a re-review. Thank you.',
  },
  {
    id: 'creative-landing', kind: 'creative', name: 'Landing page',
    keywords: ['landing page', 'website', 'url', 'functional', 'unavailable', 'mismatch', 'inconsistent', 'redirect'],
    text: 'Hello TikTok Ads Review Team, our ad "{ad_name}" (Ad ID: {ad_id}) was rejected for: {reason}. We have verified that the landing page is fully functional, loads correctly on mobile, and the products and prices shown are consistent with the ad. Please kindly re-review this ad. Thank you.',
  },
  {
    id: 'creative-prohibited', kind: 'creative', name: 'Prohibited / restricted products',
    keywords: ['prohibited', 'restricted', 'weapon', 'drug', 'tobacco', 'alcohol', 'supplement', 'weight loss', 'medical'],
    text: 'Hello TikTok Ads Review Team, our ad "{ad_name}" (Ad ID: {ad_id}) was rejected for: {reason}. The advertised product is a general consumer product that is not in any prohibited or restricted category, and it is legally sold in the targeted region. We kindly request a re-review. Thank you.',
  },
  {
    id: 'creative-ip', kind: 'creative', name: 'Intellectual property / brand',
    keywords: ['intellectual', 'copyright', 'trademark', 'counterfeit', 'brand', 'music'],
    text: 'Hello TikTok Ads Review Team, our ad "{ad_name}" (Ad ID: {ad_id}) was rejected for: {reason}. All visuals, music and brand elements used in this ad are original or properly licensed, and we do not sell counterfeit goods. We can provide proof of authorization upon request. Please kindly re-review. Thank you.',
  },
  {
    id: 'creative-quality', kind: 'creative', name: 'Low quality creative',
    keywords: ['low quality', 'quality', 'blur', 'resolution', 'audio', 'black screen', 'cropped'],
    text: 'Hello TikTok Ads Review Team, our ad "{ad_name}" (Ad ID: {ad_id}) was rejected for: {reason}. The video is high resolution, has clear audio and displays correctly in the TikTok feed. We kindly request a re-review of this ad. Thank you.',
  },
  {
    id: 'creative-adult', kind: 'creative', name: 'Sensitive / adult content',
    keywords: ['sexual', 'nudity', 'adult', 'suggestive', 'violence', 'shocking', 'sensitive'],
    text: 'Hello TikTok Ads Review Team, our ad "{ad_name}" (Ad ID: {ad_id}) was rejected for: {reason}. The ad contains no sexual, suggestive, violent or shocking content and is suitable for a general audience. We kindly request a re-review. Thank you.',
  },
  {
    id: 'account-default', kind: 'account', name: 'Appeal account bị suspend', keywords: [],
    text: 'Dear TikTok Ads Team, our ad account "{advertiser_name}" (Advertiser ID: {advertiser_id}, company: {company}) has been suspended. Reason shown: {reason}. We have carefully reviewed all of our ads, removed or edited any content that could be considered non-compliant, and verified that our landing pages and products comply with TikTok Advertising Policies. We are committed to following the policies going forward and kindly request that our account be reinstated. Thank you for your support.',
  },
];

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

module.exports = { DEFAULT_TEMPLATES, render, matchTemplate, creativeVars, accountVars, newId };
