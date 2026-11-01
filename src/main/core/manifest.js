// Манифест версий Mojang + кэш
const { fetchJson } = require('./net');
const { readJson, writeJson, exists, path, fsp } = require('./util');
const { launcherDataDir } = require('./paths');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const EXPERIMENTAL_URL = 'https://launchermeta.mojang.com/mc/v1/experimental_versions_slim.json';
const CACHE_FILE = path.join(launcherDataDir(), 'version-manifest-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

let cache = null; // { time, versions: [{id, type, url, releaseTime}], experimental: [ids] }

async function getManifest(force = false) {
  if (!force && cache && Date.now() - cache.time < CACHE_TTL) return cache;
  try {
    if (!force && await exists(CACHE_FILE)) {
      const disk = await readJson(CACHE_FILE);
      if (Date.now() - disk.time < CACHE_TTL) { cache = disk; return cache; }
    }
  } catch { /* игнорируем битый кэш */ }

  const m = await fetchJson(MANIFEST_URL);
  let experimental = [];
  try {
    const e = await fetchJson(EXPERIMENTAL_URL);
    experimental = (Array.isArray(e) ? e : []).map(v => v.id || v);
  } catch { experimental = []; }

  cache = {
    time: Date.now(),
    latest: m.latest,
    versions: m.versions.map(v => ({ id: v.id, type: v.type, url: v.url, releaseTime: v.releaseTime })),
    experimental,
  };
  try { await writeJson(CACHE_FILE, cache); } catch { /* некритично */ }
  return cache;
}

// Версии по категориям (список идентификаторов для «экспериментальных»)
function categories() {
  if (!cache) return {};
  const ids = new Set(cache.experimental);
  const byType = { release: [], snapshot: [], old_beta: [], old_alpha: [] };
  for (const v of cache.versions) {
    if (byType[v.type]) byType[v.type].push(v);
  }
  return { byType, experimentalIds: ids };
}

async function findVersion(id) {
  const m = await getManifest();
  return m.versions.find(v => v.id === id) || null;
}

// Полная JSON-метаданные версии (с сервера Mojang)
async function getVersionMeta(id) {
  const v = await findVersion(id);
  if (!v) throw new Error('Версия ' + id + ' не найдена в манифесте Mojang');
  return fetchJson(v.url);
}

module.exports = { getManifest, categories, findVersion, getVersionMeta, EXPERIMENTAL_URL };
