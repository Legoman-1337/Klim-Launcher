// Java: поиск установленных JRE + автоскачивание Temurin (Adoptium)
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const path = require('path');
const { fetchJson, downloadFile } = require('./net');
const { Paths } = require('./paths');
const { progress } = require('./events');
const { fsp, ensureDir, exists } = require('./util');

const ADOPTIUM = (feature) =>
  `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse`;

// Поиск java.exe в типичных местах
async function detectInstalledJavas() {
  const candidates = [];
  const pushIfExists = (p) => candidates.push(p);

  const roots = [
    'C:/Program Files/Java',
    'C:/Program Files (x86)/Java',
    'C:/Program Files/Eclipse Adoptium',
    'C:/Program Files (x86)/Eclipse Adoptium',
    'C:/Program Files/Microsoft',
    path.join(require('os').homedir(), '.jdks'),
    path.join(require('os').homedir(), 'AppData', 'Local', 'Programs', 'Eclipse Adoptium'),
  ];
  for (const root of roots) {
    let entries = [];
    try { entries = await fsp.readdir(root); } catch { continue; }
    for (const e of entries) {
      pushIfExists(path.join(root, e, 'bin', 'java.exe'));
    }
  }
  if (process.env.JAVA_HOME) pushIfExists(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  // JAVA_HOME из реестра часто не в env — спросим через where
  try {
    const { stdout } = await exec('where', ['java'], { timeout: 5000 });
    for (const line of stdout.split(/\r?\n/)) if (line.trim().toLowerCase().endsWith('java.exe')) pushIfExists(line.trim());
  } catch { /* where ничего не нашёл */ }

  const found = [];
  for (const p of [...new Set(candidates)]) {
    const ver = await getJavaVersion(p);
    if (ver) found.push({ path: p, version: ver.major, versionStr: ver.raw });
  }
  return found;
}

async function getJavaVersion(javaExe) {
  try {
    const { stdout } = await exec(javaExe, ['-version'], { timeout: 10000 });
    const m = /version "([^"]+)"/.exec(stdout);
    if (!m) return null;
    const parts = m[1].split('.');
    let major = Number(parts[0]);
    if (major === 1 && parts[1]) major = Number(parts[1]); // старая нумерация 1.8.0
    return { major, raw: m[1] };
  } catch { return null; }
}

// Скачивание JRE нужной версии (Temurin) в папку игры
async function installJre(gameDir, feature) {
  const paths = await Paths.create(gameDir);
  progress({ phase: 'java', label: `Поиск Java ${feature}`, percent: 0.05 });
  const assets = await fetchJson(ADOPTIUM(feature));
  const pkg = assets.find(a => a.binary && a.binary.package && a.binary.package.name.endsWith('.zip'));
  if (!pkg) throw new Error('Не найден пакет Temurin JRE ' + feature + ' для Windows x64');

  const destZip = path.join(paths.jres(), pkg.binary.package.name);
  await downloadFile(pkg.binary.package.link, destZip, (rec, total) => {
    progress({ phase: 'java', label: `Скачивание Java ${feature}`, percent: Math.min(0.95, rec / (total || 1)) });
  });

  progress({ phase: 'java', label: 'Распаковка Java', percent: 0.96 });
  const extract = require('extract-zip');
  const target = paths.jreDir(feature);
  await ensureDir(path.dirname(target));
  await fsp.rm(target, { recursive: true, force: true });
  const extractTmp = target + '-tmp';
  await fsp.rm(extractTmp, { recursive: true, force: true });
  await extract(destZip, { dir: extractTmp });
  // В архиве одна папка вида jdk-21.0.x+y — переименовываем
  const inner = (await fsp.readdir(extractTmp))[0];
  await fsp.rename(path.join(extractTmp, inner), target);
  await fsp.rm(extractTmp, { recursive: true, force: true });
  await fsp.rm(destZip, { force: true }).catch(() => {});
  progress({ phase: 'java', label: 'Java готова', percent: 1 });

  const javaExe = path.join(target, 'bin', 'java.exe');
  const ver = await getJavaVersion(javaExe);
  return { path: javaExe, version: ver ? ver.major : feature, versionStr: ver ? ver.raw : String(feature) };
}

// Резолв Java для версии игры: сначала ручной путь, потом установленные, потом скачивание
async function resolveJava(gameDir, requiredFeature, cfg) {
  const installed = await detectInstalledJavas();

  if (cfg.java && cfg.java.path) {
    const v = await getJavaVersion(cfg.java.path);
    if (v) return { path: cfg.java.path, version: v.major, versionStr: v.raw, downloaded: false };
  }
  if (cfg.java && cfg.java.auto === false && installed.length) {
    // берём максимально подходящую установленную
    const best = installed.sort((a, b) => Math.abs(a.version - requiredFeature) - Math.abs(b.version - requiredFeature))[0];
    return { ...best, downloaded: false };
  }

  // JRE, ранее скачанная лаунчером
  const paths = await Paths.create(gameDir);
  const local = path.join(paths.jreDir(requiredFeature), 'bin', 'java.exe');
  if (await exists(local)) {
    const v = await getJavaVersion(local);
    return { path: local, version: v ? v.major : requiredFeature, versionStr: v ? v.raw : '', downloaded: false };
  }

  // Подходящая установленная (с запасом вверх для 8/11/16 → 17+)
  const compatible = installed.find(j => j.version === requiredFeature) ||
    installed.find(j => requiredFeature < 17 && j.version >= Math.max(requiredFeature, 17));
  if (compatible) return { ...compatible, downloaded: false };

  return installJre(gameDir, requiredFeature);
}

module.exports = { detectInstalledJavas, getJavaVersion, installJre, resolveJava };
