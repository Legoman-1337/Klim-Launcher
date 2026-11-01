// Тест ядра: установка 1.20.1 + Fabric + подготовка запуска (без Electron)
process.env.KLIM_TEST = '1';
const path = require('path');

const GAME_DIR = process.argv[2] || path.join(__dirname, '..', 'test-game');
const MC = '1.20.1';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const { installVersion } = require('../src/main/core/installer');
  const { bus } = require('../src/main/core/events');
  const fabric = require('../src/main/core/fabric');
  const accounts = require('../src/main/core/accounts');
  const config = require('../src/main/core/config');

  bus.on('progress', (p) => {
    const pct = Math.round((p.percent || 0) * 100);
    if (pct % 10 === 0) log(`[${p.label}] ${pct}%`);
  });
  bus.on('task', (t) => log('task:', JSON.stringify(t)));

  log('Установка', MC, 'в', GAME_DIR);
  await installVersion(GAME_DIR, MC);
  log('Ваниль установлена ✓');

  log('Установка Fabric...');
  const fid = await fabric.installFabric(GAME_DIR, MC, (await fabric.loaderVersions(1))[0]);
  const { Paths } = require('../src/main/core/paths');
  const { readJson } = require('../src/main/core/util');
  const paths = await Paths.create(GAME_DIR);
  const fabricMeta = await readJson(paths.versionJson(fid));
  await require('../src/main/core/installer').installLibraries(paths, fabricMeta);
  log('Fabric установлен:', fid, '✓');

  // Проверка подготовки запуска
  await config.load();
  const cfg = config.get();
  cfg.gameDir = GAME_DIR;
  cfg.memory = { auto: true, mb: 4096 };
  accounts.addAccount(cfg, 'TestUser');
  const { prepareLaunch } = require('../src/main/core/launch');
  const prepared = await prepareLaunch({
    gameDir: GAME_DIR, versionId: fid,
    account: accounts.currentAccount(cfg), cfg, width: 925, height: 530,
  });
  log('Java:', prepared.javaPath);
  log('Память:', prepared.memMb, 'МБ');
  log('VM args:', prepared.vmArgs.slice(0, 6).join(' '), '...');
  log('Game args:', prepared.gameArgs.join(' '));
  log('Рабочая папка:', prepared.workDir);
  log('ВСЁ ГОТОВО ✓');
  process.exit(0);
})().catch(err => {
  console.error('ТЕСТ УПАЛ:', err);
  process.exit(1);
});
