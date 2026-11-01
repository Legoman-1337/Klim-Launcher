// Forge: список версий из maven metadata + установка headless-инсталлером
const { fetchText, downloadFile } = require('./net');
const { Paths } = require('./paths');
const { progress } = require('./events');
const { fsp, ensureDir, exists, path } = require('./util');

const MAVEN_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const PROMO_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

let metaCache = null;

async function allForgeVersions() {
  if (metaCache) return metaCache;
  const xml = await fetchText(MAVEN_META);
  metaCache = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
  return metaCache;
}

// Версии Forge для конкретной версии Minecraft
async function forgeVersionsFor(mc) {
  const all = await allForgeVersions();
  const mine = all.filter(v => v.startsWith(mc + '-'));
  // Отдаём по убыванию: новые сборки первыми
  return mine.reverse();
}

async function recommendedForge() {
  try {
    const promo = await fetchJson(PROMO_URL);
    const p = promo.promos || {};
    const out = {};
    for (const [key, val] of Object.entries(p)) {
      if (key.endsWith('-recommended')) out[key.replace('-recommended', '')] = val;
    }
    return out;
  } catch { return {}; }
}

// Установка: качаем installer и запускаем `java -jar forge-installer.jar --installClient <gameDir>`
async function installForge(gameDir, mcVersion, forgeVersion, javaExe) {
  const full = forgeVersion.includes(mcVersion) ? forgeVersion : `${mcVersion}-${forgeVersion}`;
  const paths = await Paths.create(gameDir);
  const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  const installerPath = path.join(paths.versionDir(full), `forge-${full}-installer.jar`);
  await ensureDir(path.dirname(installerPath));

  progress({ phase: 'install', label: 'Скачивание установщика Forge', percent: 0.1 });
  if (!(await exists(installerPath))) {
    await downloadFile(installerUrl, installerPath, (rec, total) => {
      progress({ phase: 'install', label: 'Скачивание установщика Forge', percent: 0.1 + 0.5 * rec / (total || 1) });
    });
  }

  progress({ phase: 'install', label: 'Установка Forge (может занять минуту)', percent: 0.6 });
  const { execFile } = require('child_process');
  await new Promise((resolve, reject) => {
    execFile(javaExe, ['-jar', installerPath, '--installClient', gameDir], {
      cwd: path.dirname(installerPath),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    }, (err, stdout, stderr) => {
      if (err) {
        const out = (stdout || '') + '\n' + (stderr || '');
        reject(new Error('Инсталлятор Forge завершился с ошибкой: ' + out.slice(-2000)));
      } else resolve();
    });
  });

  // Инсталлятор создаёт папку versions/<forge-full> с json; jar для старых версий, для новых библиотечный
  const jsonPath = paths.versionJson(full);
  if (!(await exists(jsonPath))) {
    // новые инсталляторы пишут json рядом (в versions/<id>) — если нет, ищем созданную папку
    const names = await fsp.readdir(paths.versions()).catch(() => []);
    const created = names.find(n => n.includes(forgeVersion));
    if (!created) throw new Error('Forge установлен, но версия не найдена в папке versions');
    return created;
  }
  progress({ phase: 'install', label: 'Forge установлен', percent: 1 });
  return full;
}

module.exports = { allForgeVersions, forgeVersionsFor, recommendedForge, installForge };
