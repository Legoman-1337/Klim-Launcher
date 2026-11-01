// Fabric: установка через официальный meta API
const { fetchJson } = require('./net');
const { writeJson, exists, path } = require('./util');
const { Paths } = require('./paths');

const META = 'https://meta.fabricmc.net/v2';

// Список версий загрузчика Fabric (новейшие)
async function loaderVersions(limit = 10) {
  const all = await fetchJson(META + '/versions/loader');
  return all.filter(v => v.stable).slice(0, limit).map(v => v.version);
}

// ID вида fabric-loader-0.16.9-1.20.1
async function installFabric(gameDir, mcVersion, loaderVersion) {
  const profile = await fetchJson(`${META}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`);
  const id = profile.id;
  const paths = await Paths.create(gameDir);
  const jsonPath = paths.versionJson(id);
  if (!(await exists(jsonPath))) {
    await writeJson(jsonPath, profile);
  }
  return id;
}

// Проверка, поддерживает ли версия Fabric (1.14+)
function fabricSupported(versionId) {
  const m = /^1\.(\d+)/.exec(versionId);
  return !!m && Number(m[1]) >= 14;
}

module.exports = { loaderVersions, installFabric, fabricSupported };
