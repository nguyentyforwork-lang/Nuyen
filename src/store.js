// Lưu trữ dạng file JSON (data/db.json). Đủ dùng cho vài nghìn account/creative.
const fs = require('fs');
const path = require('path');
const { DEFAULT_TEMPLATES, TEMPLATES_VERSION, LEGACY_BUILTIN_IDS } = require('./templates');

const DEFAULT_SETTINGS = {
  autoScan: true,
  scanIntervalMinutes: 60,
  autoAppeal: false,
  autoAppealScope: 'all', // all | suspended | active
  defaultTemplateId: 'creative-default',
  maxAppealsPerRun: 50,
  maxAppealsPerAd: 1,
  templatesVersion: TEMPLATES_VERSION,
};

function createStore(file = path.join(__dirname, '..', 'data', 'db.json')) {
  let db = { accounts: {}, creatives: {}, appealLog: [], scans: [], settings: { ...DEFAULT_SETTINGS }, templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })) };
  if (fs.existsSync(file)) {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    db = { ...db, ...loaded, settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}), templatesVersion: (loaded.settings || {}).templatesVersion || 1 } };
    delete db.settings.appealReason;
    if (!Array.isArray(db.templates) || !db.templates.length) db.templates = DEFAULT_TEMPLATES.map((t) => ({ ...t }));
    if (db.settings.templatesVersion < TEMPLATES_VERSION) {
      // Thay template có sẵn bằng bộ mới, giữ nguyên template người dùng tự tạo
      const builtinIds = new Set([...LEGACY_BUILTIN_IDS, ...DEFAULT_TEMPLATES.map((t) => t.id)]);
      db.templates = [...DEFAULT_TEMPLATES.map((t) => ({ ...t })), ...db.templates.filter((t) => !builtinIds.has(t.id))];
      if (!db.templates.some((t) => t.id === db.settings.defaultTemplateId)) db.settings.defaultTemplateId = 'creative-default';
      db.settings.templatesVersion = TEMPLATES_VERSION;
    }
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
