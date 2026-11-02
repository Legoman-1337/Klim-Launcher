// Главный процесс: окно + все IPC-обработчики
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { fs } = require('./core/util');

const config = require('./core/config');
const { Paths, launcherDataDir } = require('./core/paths');
const { bus } = require('./core/events');

const EDITION = process.env.KLIM_EDITION === 'lite' ? 'lite' : 'full';

let win = null;
let paths = null;

// Корректная группировка в таскбаре Win10/11 и уведомления
app.setAppUserModelId(EDITION === 'lite' ? 'ru.klim.launcher.lite' : 'ru.klim.launcher');

function appIcon() {
  const p = path.join(__dirname, '..', '..', 'build', 'icon.ico');
  try { require('fs').accessSync(p); return p; } catch { return undefined; }
}

function createWindow() {
  const cfg = config.get();
  const size = cfg.windowSize || { width: 960, height: 560 };
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 860,
    minHeight: 500,
    frame: false,
    show: false, // показываем по ready-to-show — без белой вспышки при старте
    backgroundColor: '#0d0716',
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (cfg.forceFullscreen) win.setFullScreen(true);
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'),
    process.env.KLIM_PAGE ? { hash: process.env.KLIM_PAGE } : (process.env.KLIM_SHOT ? { search: '?static=1' } : {}));
  // Dev-инструмент: KLIM_SHOT=<путь> — скриншот окна через 5 секунд и выход
  if (process.env.KLIM_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        win.show();
        await new Promise(r => setTimeout(r, 400));
        for (let i = 0; i < 5; i++) {
          try {
            const img = await win.webContents.capturePage();
            const png = img.toPNG();
            if (png.length > 0) {
              require('fs').writeFileSync(process.env.KLIM_SHOT, png);
              break;
            }
          } catch (e) { /* ретрай */ }
          await new Promise(r => setTimeout(r, 700));
        }
        app.exit(0);
      }, 5000);
    });
  }
  win.on('closed', () => { win = null; });
}

// Установка версии (ваниль + опциональный загрузчик). Используется и UI, и автодоустановкой перед запуском.
async function performInstall(versionId) {
  const cfg = config.get();
  const { installVersion } = require('./core/installer');
  const { taskState } = require('./core/events');
  const { fabricLoaderFromId, forgeLoaderFromId } = require('./core/loaderids');
  taskState({ kind: 'install', state: 'start', versionId });
  try {
    const fabricInfo = fabricLoaderFromId(versionId);
    const forgeInfo = forgeLoaderFromId(versionId);
    const mcId = fabricInfo ? fabricInfo.mcId : forgeInfo ? forgeInfo.mcId : versionId;

    await installVersion(cfg.gameDir, mcId);

    if (fabricInfo) {
      const fid = await require('./core/fabric').installFabric(cfg.gameDir, mcId, fabricInfo.loader);
      // Библиотеки лоадера Fabric (asm, mixin, intermediary, loader)
      const fabricMeta = await require('./core/util').readJson(paths.versionJson(fid));
      await require('./core/installer').installLibraries(paths, fabricMeta);
    } else if (forgeInfo) {
      const meta = await require('./core/manifest').getVersionMeta(mcId);
      const required = (meta.javaVersion && meta.javaVersion.majorVersion) || 8;
      const java = await require('./core/java').resolveJava(cfg.gameDir, Math.min(required, 21), cfg);
      await require('./core/forge').installForge(cfg.gameDir, mcId, forgeInfo.loader, java.path);
    }
    taskState({ kind: 'install', state: 'done', versionId });
    return { ok: true };
  } catch (err) {
    require('./core/events').taskState({ kind: 'install', state: 'error', message: err.message, versionId });
    return { ok: false, error: err.message };
  }
}

function registerIpc() {
  // — окно —
  ipcMain.on('window:minimize', () => win && win.minimize());
  ipcMain.on('window:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('window:close', () => win && win.close());

  // — информация —
  ipcMain.handle('app:info', () => ({
    edition: EDITION,
    version: app.getVersion(),
    platform: process.platform,
    configPath: config.CONFIG_FILE,
  }));

  // — настройки —
  ipcMain.handle('settings:get', () => config.get());
  ipcMain.handle('settings:set', async (e, patch) => {
    const oldDir = config.get().gameDir;
    const cfg = await config.save(patch);
    if (patch && patch.gameDir && patch.gameDir !== oldDir) {
      paths = await Paths.create(cfg.gameDir);
    }
    if (patch && patch.windowSize && win) {
      win.setSize(patch.windowSize.width, patch.windowSize.height);
    }
    if (patch && 'forceFullscreen' in patch && win) win.setFullScreen(!!patch.forceFullscreen);
    return cfg;
  });

  // — диалоги —
  ipcMain.handle('dialog:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('dialog:pickBackground', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const { fsp, ensureDir } = require('./core/util');
    const bgDir = path.join(launcherDataDir(), 'backgrounds');
    await ensureDir(bgDir);
    const dest = path.join(bgDir, 'custom' + path.extname(res.filePaths[0]).toLowerCase());
    await fsp.copyFile(res.filePaths[0], dest);
    return dest;
  });

  // — версии —
  ipcMain.handle('versions:list', async (e, filters) => {
    const { listVersions } = require('./core/versions');
    return listVersions(config.get().gameDir, filters || {});
  });
  ipcMain.handle('loaders:for', async (e, mcId) => {
    const { loadersFor } = require('./core/versions');
    return loadersFor(mcId);
  });
  ipcMain.handle('versions:local', async () => Paths.localVersions(config.get().gameDir));
  ipcMain.handle('versions:remove', async (e, id) => {
    const { removeDir } = require('./core/util');
    await removeDir(paths.versionDir(id), paths.versions());
    return true;
  });

  // — установка —
  ipcMain.handle('versions:install', async (e, versionId) => {
    global.installRunning = true;
    try { return await performInstall(versionId); }
    finally { global.installRunning = false; }
  });
  ipcMain.on('install:cancel', () => require('./core/installer').cancelInstall());

  // — java —
  ipcMain.handle('java:list', async () => require('./core/java').detectInstalledJavas());
  ipcMain.handle('java:install', async (e, feature) => {
    try { return { ok: true, java: await require('./core/java').installJre(config.get().gameDir, feature) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // — аккаунты —
  ipcMain.handle('accounts:add', (e, name) => {
    try { return { ok: true, accounts: require('./core/accounts').addAccount(config.get(), name) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('accounts:remove', (e, name) => ({
    ok: true,
    accounts: require('./core/accounts').removeAccount(config.get(), name),
  }));
  ipcMain.handle('accounts:select', (e, name) => {
    try { return { ok: true, accounts: require('./core/accounts').selectAccount(config.get(), name) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // — запуск —
  ipcMain.handle('launch:start', async (e, opts = {}) => {
    global.installRunning = true;
    try {
      const cfg = config.get();
      const account = require('./core/accounts').currentAccount(cfg);
      if (!account) return { ok: false, error: 'Сначала добавь ник в панели запуска' };
      const versionId = opts.versionId || cfg.lastVersionId;
      if (!versionId) return { ok: false, error: 'Не выбрана версия игры' };

      const { fabricLoaderFromId, forgeLoaderFromId } = require('./core/loaderids');
      const fabricInfo = fabricLoaderFromId(versionId);
      const forgeInfo = forgeLoaderFromId(versionId);
      const mcId = fabricInfo ? fabricInfo.mcId : forgeInfo ? forgeInfo.mcId : versionId;

      const needBase = !(fs.existsSync(paths.versionJson(mcId)) && fs.existsSync(paths.versionJar(mcId)));
      const needLoader = fabricInfo && !fs.existsSync(paths.versionJson(versionId));
      if (opts.refresh || needBase || needLoader) {
        const res = await performInstall(versionId);
        if (!res.ok) return { ok: false, error: res.error };
      }

      const result = await require('./core/launch').launchGame({
        gameDir: cfg.gameDir,
        versionId,
        account,
        cfg,
        width: cfg.windowSize && cfg.windowSize.width,
        height: cfg.windowSize && cfg.windowSize.height,
      });
      if (cfg.closeAfterLaunch) setTimeout(() => app.quit(), 1500);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      global.installRunning = false;
    }
  });

  // — файлы —
  ipcMain.handle('fs:open', async (e, kind) => {
    const map = {
      root: paths.game,
      mods: paths.mods(),
      resourcepacks: paths.resourcepacks(),
      screenshots: paths.screenshots(),
      versions: paths.versions(),
      logs: paths.logs(),
      config: config.CONFIG_FILE,
    };
    const target = map[kind] || paths.game;
    await require('./core/util').ensureDir(target);
    await shell.openPath(target);
    return true;
  });

  // — события в UI —
  bus.on('progress', (p) => win && win.webContents.send('progress', p));
  bus.on('task', (t) => win && win.webContents.send('task', t));
}

async function init() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }

  await config.load();
  paths = await Paths.create(config.get().gameDir);

  registerIpc();
  await app.whenReady();
  createWindow();
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('window-all-closed', () => app.quit());
}

init().catch(err => {
  console.error('Ошибка запуска Klim:', err);
  app.quit();
});
