// Установка версии Minecraft: клиент, библиотеки, ассеты, natives, лог-конфиг
const { fetchJson, downloadFile, runQueue } = require('./net');
const { Paths } = require('./paths');
const { progress } = require('./events');
const { fsp, ensureDir, exists, readJson, writeJson, path } = require('./util');

let cancelFlag = false;
function cancelInstall() { cancelFlag = true; }

function checkCancelled() {
  if (cancelFlag) throw new Error('Установка отменена');
}

// Фаза/прогресс: единый формат для UI
function phase(label, percent) {
  progress({ phase: 'install', label, percent });
}

// Правила Mojang: последнее подходящее правило выигрывает; правило без совпадения = запрет
function isLibraryAllowed(lib) {
  if (!lib.rules || !lib.rules.length) return true;
  let matched = false;
  let allowed = false;
  for (const rule of lib.rules) {
    const osName = typeof rule.os === 'string' ? rule.os : rule.os && rule.os.name;
    if (osName && osName !== 'windows') continue;
    if (rule.os && rule.os.architecture && rule.os.architecture !== 'x64') continue;
    if (rule.features) continue; // demo/quickPlay и пр. не включаем
    matched = true;
    allowed = rule.action === 'allow';
  }
  return matched && allowed;
}

function libArtifactPath(lib) {
  const d = lib.downloads && lib.downloads.artifact;
  if (d) return { url: d.url, dest: d.path, size: d.size || 0, sha1: d.sha1 };
  // Библиотеки без прямой ссылки (Fabric и др.) собираем из координат maven
  if (!lib.name) return null;
  const parts = lib.name.split(':');
  if (parts.length < 3) return null;
  const [group, name, ver] = parts;
  const rel = path.join(...group.split('.'), name, ver, `${name}-${ver}.jar`);
  if (lib.url) {
    // lib.url — база maven-репозитория
    return { url: lib.url.replace(/\/?$/, '/') + rel.split(path.sep).join('/'), dest: rel, size: lib.size || 0, sha1: lib.sha1 };
  }
  return { url: null, dest: rel, size: 0, sha1: null };
}

// Установка библиотек произвольной версии (ваниль или профиль загрузчика)
async function installLibraries(paths, meta, cb) {
  const libs = (meta.libraries || []).filter(isLibraryAllowed);
  const tasks = [];
  for (const lib of libs) {
    const art = libArtifactPath(lib);
    if (!art || !art.url) continue;
    // Нативы Windows: либо classifier, либо отдельный артефакт вида ...:natives-windows (1.19+)
    const isWinNative = (lib.name && lib.name.endsWith(':natives-windows')) ||
      (lib.name && /:natives-windows(@\d+)?$/.test(lib.name));
    tasks.push({
      label: lib.name,
      run: async () => {
        checkCancelled();
        const dest = path.join(paths.libraries(), art.dest);
        if (!(await isFileOk(dest, art.size, art.sha1))) await downloadFile(art.url, dest);
        if (isWinNative) await extractNatives(dest, paths.nativesDir(meta.id || 'shared'));
      },
    });
    const nat = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers['natives-windows'];
    if (nat) {
      tasks.push({
        label: lib.name + ' natives',
        run: async () => {
          checkCancelled();
          const dest = path.join(paths.libraries(), nat.path);
          if (!(await isFileOk(dest, nat.size, nat.sha1))) await downloadFile(nat.url, dest);
          await extractNatives(dest, paths.nativesDir(meta.id || 'shared'));
        },
      });
    }
  }
  await runQueue(tasks, 8, (frac) => cb && cb(frac, 1));
  return tasks.length;
}

async function installVersion(gameDir, versionId, opts = {}) {
  cancelFlag = false;
  const paths = await Paths.create(gameDir);

  phase('Получение данных версии', 0.02);
  checkCancelled();
  const meta = await fetchJson((await require('./manifest').findVersion(versionId)).url);
  await writeJson(paths.versionJson(versionId), meta);

  const jobs = [];

  // Клиентский jar
  const client = meta.downloads && meta.downloads.client;
  if (client) {
    jobs.push({ label: 'Клиент', weight: Math.max(1, (client.size || 1) / 1e6), run: async (cb) => {
      checkCancelled();
      await downloadFile(client.url, paths.versionJar(versionId), (rec, total) => cb(rec, total || client.size));
    } });
  }

  // Библиотеки (включая natives)
  jobs.push({ label: 'Библиотеки', weight: Math.max(1, (meta.libraries || []).length / 4), run: async (cb) => {
    await installLibraries(paths, meta, (done, total) => cb(done, total));
  } });

  // Ассеты
  const assetsMeta = meta.assetIndex;
  if (assetsMeta) {
    jobs.push({ label: 'Ресурсы игры', weight: 12, run: async (cb) => {
      checkCancelled();
      await installAssets(paths, meta, cb);
    } });
  }

  // Лог-конфиг (log4j)
  const logging = meta.logging && meta.logging.client;
  let loggingCfg = null;
  if (logging && logging.file) {
    const f = logging.file;
    const dest = path.join(paths.assets(), 'log_configs', f.id);
    jobs.push({ label: 'Лог-конфиг', weight: 0.5, run: async () => {
      checkCancelled();
      await downloadFile(f.url, dest);
    } });
    loggingCfg = dest;
  }

  // Выполняем все фазы с общим прогрессом
  const totalWeight = jobs.reduce((s, j) => s + j.weight, 0);
  let doneWeight = 0;
  for (const job of jobs) {
    checkCancelled();
    const startFrac = doneWeight / totalWeight;
    const span = job.weight / totalWeight;
    await job.run((done, total) => {
      phase(job.label, startFrac + span * Math.min(1, done / (total || 1)));
    });
    doneWeight += job.weight;
    phase(job.label, startFrac + span);
  }

  // Виртуальные ассеты для старых версий
  if (assetsMeta && (meta.assets === 'legacy' || meta.assets === 'pre-1.6')) {
    phase('Совместимые ресурсы старой версии', 0.97);
    await buildVirtualAssets(paths, meta.assets);
  }

  phase('Готово', 1);
  return { versionId, loggingCfg };
}

async function isFileOk(dest, size, sha1) {
  try {
    const st = await fsp.stat(dest);
    if (size && st.size !== size) return false;
    return true;
  } catch { return false; }
}

// Распаковка нативов: строго по очереди — параллельные извлечения в одну папку конфликтуют
let extractQueue = Promise.resolve();
async function extractNatives(jarPath, destDir) {
  const run = extractQueue.then(async () => {
    const extract = require('extract-zip');
    await extract(jarPath, { dir: destDir });
    // В natives оставляем только dll — остальное из архива лишнее
    const entries = await fsp.readdir(destDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.name.endsWith('.dll')) {
        await fsp.rm(path.join(destDir, e.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  });
  extractQueue = run.catch(() => {});
  return run;
}

async function installAssets(paths, meta, cb) {
  const assetsMeta = meta.assetIndex;
  const indexName = meta.assets;
  const indexPath = paths.assetIndex(indexName);
  if (!(await exists(indexPath))) {
    await downloadFile(assetsMeta.url, indexPath);
  }
  const index = await readJson(indexPath);
  const objects = Object.values(index.objects || {});
  const total = objects.length;
  let done = 0;

  const tasks = objects.map(o => ({
    run: async () => {
      checkCancelled();
      const p = path.join(paths.assets(), 'objects', o.hash.slice(0, 2), o.hash);
      if (await isFileOk(p, o.size)) return;
      await downloadFile(`https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`, p);
    },
  }));
  await runQueue(tasks, 24, (frac) => cb(frac * total, total));
}

async function buildVirtualAssets(paths, assetsName) {
  const index = await readJson(paths.assetIndex(assetsName));
  const vdir = paths.virtualAssets(assetsName);
  await ensureDir(vdir);
  const entries = Object.entries(index.objects || {});
  let copied = 0;
  for (const [rel, o] of entries) {
    const src = path.join(paths.assets(), 'objects', o.hash.slice(0, 2), o.hash);
    const dest = path.join(vdir, rel);
    try {
      const st = await fsp.stat(dest);
      if (st.size === (o.size || st.size)) { copied++; continue; }
    } catch { /* нет файла — копируем */ }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest).catch(() => {});
    copied++;
  }
}

module.exports = { installVersion, installLibraries, cancelInstall, isLibraryAllowed, libArtifactPath, extractNatives };
