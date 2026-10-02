// Lưu trữ dạng file JSON (data/db.json). Đủ dùng cho vài nghìn account/creative.
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  autoScan: true,
  scanIntervalMinutes: 60,
  autoAppeal: false,
  appealReason: 'We have reviewed our ad and believe it complies with TikTok Advertising Policies. Please kindly re-review this ad. Thank you.',
  maxAppealsPerRun: 50,
  maxAppealsPerAd: 1,
};

function createStore(file = path.join(__dirname, '..', 'data', 'db.json')) {
  let db = { accounts: {}, creatives: {}, appealLog: [], scans: [], settings: { ...DEFAULT_SETTINGS } };
  if (fs.existsSync(file)) {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    db = { ...db, ...loaded, settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) } };
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
  }

  return { get db() { return db; }, save };
}

module.exports = { createStore, DEFAULT_SETTINGS };
