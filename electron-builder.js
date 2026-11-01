// Конфиг electron-builder: две сборки из одного проекта (KLIM_EDITION=full|lite)
module.exports = function () {
  const lite = process.env.KLIM_EDITION === 'lite';
  const name = lite ? 'Klim Lite' : 'Klim Launcher';
  return {
    appId: lite ? 'ru.klim.launcher.lite' : 'ru.klim.launcher',
    productName: name,
    directories: { output: lite ? 'dist/lite' : 'dist/full' },
    files: ['src/**/*', 'package.json', '!tools/**'],
    win: {
      icon: 'build/icon.ico',
      // rcedit внутри electron-builder требует winCodeSign (симлинки без прав админа падают),
      // иконку в exe ставим вручную после сборки (tools/apply-icon.js)
      signAndEditExecutable: false,
      target: [
        { target: 'nsis', arch: ['x64'] },
        { target: 'portable', arch: ['x64'] },
      ],
      artifactName: '${productName}-${version}-${arch}.${ext}',
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      shortcutName: name,
      installerIcon: 'build/icon.ico',
      uninstallerIcon: 'build/icon.ico',
    },
    portable: { artifactName: '${productName}-${version}-portable.${ext}' },
  };
};
