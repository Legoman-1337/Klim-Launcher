// Присвоение иконки exe через rcedit после сборки (обход winCodeSign/симлинков)
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const RCEDIT = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign', '726830923', 'rcedit-x64.exe');

async function run(exe) {
  if (!fs.existsSync(RCEDIT)) { console.error('rcedit не найден: ' + RCEDIT); process.exit(1); }
  if (!fs.existsSync(exe)) { console.error('exe не найден: ' + exe); process.exit(1); }
  await new Promise((resolve, reject) => {
    execFile(RCEDIT, [exe, '--set-icon', path.join(__dirname, '..', 'build', 'icon.ico'),
      '--set-version-string', 'ProductName', process.env.KLIM_PRODUCT || 'Klim Launcher'], (err) => {
      if (err) reject(err); else resolve();
    });
  });
  console.log('Иконка применена:', exe);
}

(async () => {
  await run(process.argv[2]);
})().catch(e => { console.error(e.message); process.exit(1); });
