// Настройка предпочитаемой видеокарты через реестр Windows (UserGpuPreferences)
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);

// mode: 'auto' | 'discrete' | 'integrated'
async function applyGpuPreference(exePath, mode) {
  if (process.platform !== 'win32') return;
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  if (mode === 'auto') {
    // снимаем принудительную настройку
    await exec('reg', ['delete', key, '/v', exePath, '/f']).catch(() => {});
    return;
  }
  // 2 = высокопроизводительная (дискретная), 1 = энергосберегающая (встроенная)
  const value = mode === 'discrete' ? 'GpuPreference=2;' : 'GpuPreference=1;';
  await exec('reg', ['add', key, '/v', exePath, '/t', 'REG_SZ', '/d', value, '/f']);
}

module.exports = { applyGpuPreference };
