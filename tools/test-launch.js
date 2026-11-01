// Тест реального запуска игры: java + fabric 1.20.1, лог в консоль, затем kill
const { spawn } = require('child_process');
const path = require('path');

const GAME_DIR = process.argv[2] || path.join(__dirname, '..', 'test-game');
const VERSION = process.argv[3] || 'fabric-loader-0.20.1-1.20.1';
const TIMEOUT = Number(process.argv[4] || 90) * 1000;

(async () => {
  await require('../src/main/core/config').load();
  const config = require('../src/main/core/config');
  const cfg = config.get();
  cfg.gameDir = GAME_DIR;
  cfg.memory = { auto: true, mb: 4096 };
  const accounts = require('../src/main/core/accounts');
  accounts.addAccount(cfg, 'TestUser');

  const { prepareLaunch } = require('../src/main/core/launch');
  const prepared = await prepareLaunch({
    gameDir: GAME_DIR, versionId: VERSION,
    account: accounts.currentAccount(cfg), cfg, width: 925, height: 530,
  });

  console.log('Запуск:', prepared.javaPath);
  const raw = require('fs').createWriteStream(path.join(__dirname, '..', 'build', 'game-raw.log'), { flags: 'w' });
  const child = spawn(prepared.javaPath, [...prepared.vmArgs, ...prepared.gameArgs], {
    cwd: prepared.workDir, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(raw);
  child.stderr.pipe(raw);
  let gotGameOutput = false;
  const timer = setTimeout(() => {
    console.log(gotGameOutput ? 'ИГРА ПОДАЁТ ПРИЗНАКИ ЖИЗНИ ✓ (убиваю процесс)' : 'Нет вывода от игры ✗');
    child.kill();
    setTimeout(() => process.exit(0), 1500);
  }, TIMEOUT);

  child.stdout.on('data', (d) => {
    const s = d.toString().trimEnd();
    if (s) { gotGameOutput = true; }
    if (/Exception|Error|FAILED|crash/i.test(s) || /Render thread|Backend library|LWJGL|Setting user/.test(s)) {
      console.log('[game]', s.split('\n')[0].slice(0, 180));
    }
  });
  child.stderr.on('data', (d) => console.log('[err]', d.toString().split('\n')[0].slice(0, 180)));
  child.on('error', (e) => { console.error('SPAWN ERROR:', e.message); process.exit(1); });
  child.on('close', (code) => { clearTimeout(timer); console.log('Процесс игры завершён, код', code); process.exit(0); });
})().catch(err => { console.error('ТЕСТ УПАЛ:', err); process.exit(1); });
