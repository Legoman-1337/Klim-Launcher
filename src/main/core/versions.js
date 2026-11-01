// Единый список версий: манифест Mojang + локальные + мод-лоадеры
const { getManifest } = require('./manifest');
const { Paths } = require('./paths');
const fabric = require('./fabric');
const forge = require('./forge');

// Плоский список версий с фильтрами
async function listVersions(gameDir, filters = {}) {
  const manifest = await getManifest();
  const local = new Set(await Paths.localVersions(gameDir));
  const f = { releases: true, snapshots: true, experimental: true, oldBeta: true, oldAlpha: false, ...filters };

  const out = [];
  const seen = new Set();
  for (const v of manifest.versions) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    const type = v.type;
    if (type === 'release' && !f.releases) continue;
    if (type === 'snapshot' && !f.snapshots) continue;
    if (type === 'old_beta' && !f.oldBeta) continue;
    if (type === 'old_alpha' && !f.oldAlpha) continue;
    if (type !== 'release' && type !== 'snapshot' && type !== 'old_beta' && type !== 'old_alpha' && !f.experimental) continue;
    out.push({ id: v.id, type, releaseTime: v.releaseTime, installed: local.has(v.id) });
  }
  // Локальные версии, которых нет в манифесте (кастомные/клонированные)
  for (const id of local) {
    if (!seen.has(id)) out.push({ id, type: 'custom', releaseTime: null, installed: true });
  }
  return out;
}

// Доступные модификации для выбранной версии Minecraft
async function loadersFor(mcId) {
  const options = [{ kind: 'vanilla', id: mcId, label: 'Без модификаций' }];
  try {
    if (fabric.fabricSupported(mcId)) {
      const loaders = await fabric.loaderVersions(5);
      for (const l of loaders) {
        options.push({ kind: 'fabric', id: `fabric-loader-${l}-${mcId}`, label: `Fabric ${l}`, mcId, loader: l });
      }
    }
  } catch { /* нет сети — пропускаем fabric */ }
  try {
    const rec = await forge.recommendedForge();
    const versions = await forge.forgeVersionsFor(mcId);
    const picked = new Set();
    if (rec[mcId]) picked.add(rec[mcId]);
    for (const v of versions.slice(0, 3)) picked.add(v);
    for (const v of picked) {
      options.push({ kind: 'forge', id: `forge-${v}`, label: `Forge ${v.replace(mcId + '-', '')}`, mcId, loader: v });
    }
  } catch { /* нет сети — пропускаем forge */ }
  return options;
}

module.exports = { listVersions, loadersFor };
