// Пути: папка лаунчера и структура папки игры (как в Legacy)
const path = require('path');
const os = require('os');
const { ensureDir, exists } = require('./util');

const APP_NAME = 'Klim Launcher';

function launcherDataDir() {
  return path.join(os.homedir(), 'AppData', 'Roaming', APP_NAME);
}

function defaultGameDir() {
  return path.join(os.homedir(), 'AppData', 'Roaming', '.klim', 'game');
}

class Paths {
  constructor(gameDir) { this.game = gameDir; }

  async init() {
    await ensureDir(this.game);
    await Promise.all([
      ensureDir(this.versions()), ensureDir(this.libraries()), ensureDir(this.assets()),
      ensureDir(this.mods()), ensureDir(this.jres()), ensureDir(this.screenshots()),
    ]);
  }

  versions() { return path.join(this.game, 'versions'); }
  versionDir(id) { return path.join(this.versions(), id); }
  versionJson(id) { return path.join(this.versionDir(id), id + '.json'); }
  versionJar(id) { return path.join(this.versionDir(id), id + '.jar'); }
  nativesDir(id) { return path.join(this.versionDir(id), 'natives-windows'); }
  libraries() { return path.join(this.game, 'libraries'); }
  assets() { return path.join(this.game, 'assets'); }
  assetIndex(name) { return path.join(this.assets(), 'indexes', name + '.json'); }
  virtualAssets(name) { return path.join(this.assets(), 'virtual', name); }
  mods() { return path.join(this.game, 'mods'); }
  screenshots() { return path.join(this.game, 'screenshots'); }
  jres() { return path.join(this.game, 'jre'); }
  jreDir(feature) { return path.join(this.jres(), 'java-runtime-' + feature); }
  logs() { return path.join(this.game, 'logs'); }
  gameLogFile() { return path.join(this.logs(), 'latest-game.log'); }

  static async create(gameDir) {
    const p = new Paths(gameDir);
    await p.init();
    return p;
  }

  static async localVersions(gameDir) {
    const dir = path.join(gameDir, 'versions');
    const out = [];
    let names = [];
    try { names = await require('./util').fsp.readdir(dir); } catch { return out; }
    for (const name of names) {
      if ((await exists(path.join(dir, name, name + '.json')))) out.push(name);
    }
    return out;
  }
}

module.exports = { Paths, launcherDataDir, defaultGameDir };
