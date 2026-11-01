// Конфиг лаунчера: загрузка/сохранение, значения по умолчанию
const { readJson, writeJson, exists, path } = require('./util');
const { launcherDataDir, defaultGameDir } = require('./paths');

const CONFIG_FILE = path.join(launcherDataDir(), 'klim-config.json');

function defaults() {
  return {
    gameDir: defaultGameDir(),
    windowSize: { width: 960, height: 560 },
    forceFullscreen: false,
    closeAfterLaunch: false,
    deferredLaunch: false,   // отложенный запуск
    refreshClient: false,    // обновлять клиент (принудительная проверка файлов)
    subfoldersPerVersion: false, // отдельные подпапки по версиям (как в Legacy)
    versionFilters: {
      releases: true,
      snapshots: true,
      experimental: true,
      oldBeta: true,
      oldAlpha: false,
    },
    java: { auto: true, path: null },
    memory: { auto: true, mb: 4096 },
    gpu: 'auto', // auto | discrete | integrated
    accounts: { list: [], selected: null },
    lastVersionId: null,
    appearance: {
      theme: 'neon',
      accent: '#b049ff',
      bgImage: null,
      bgDim: 0.45,
      bgBlur: 0,
      animations: true,
    },
  };
}

let cache = null;

async function load() {
  if (cache) return cache;
  let data = {};
  if (await exists(CONFIG_FILE)) {
    try { data = await readJson(CONFIG_FILE); } catch { data = {}; }
  }
  cache = deepMerge(defaults(), data);
  return cache;
}

async function save(patch) {
  if (patch) cache = deepMerge(cache || await load(), patch);
  await writeJson(CONFIG_FILE, cache);
  return cache;
}

function get() {
  return cache;
}

function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== 'object' || Array.isArray(base) || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch;
  }
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = k in base ? deepMerge(base[k], patch[k]) : patch[k];
  }
  return out;
}

module.exports = { load, save, get, CONFIG_FILE, defaults };
