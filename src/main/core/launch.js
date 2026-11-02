// Сборка аргументов и запуск Minecraft
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { fsp, ensureDir, exists, readJson } = require('./util');
const { Paths } = require('./paths');
const { progress, taskState } = require('./events');
const javaMgr = require('./java');
const { isLibraryAllowed, libArtifactPath } = require('./installer');
const { extractNatives } = require('./installer');
const { applyGpuPreference } = require('./gpu');

// Цепочка версии: наследуемые версии (Forge/Fabric наследуют ваниль)
async function resolveChain(paths, versionId) {
  const chain = [];
  let id = versionId;
  for (let i = 0; i < 10; i++) {
    const meta = await readJson(paths.versionJson(id));
    chain.unshift(meta);
    if (!meta.inheritsFrom) break;
    id = meta.inheritsFrom;
  }
  return chain;
}

function mergeChains(chain) {
  // Наследник перекрывает родителя, но аргументы и библиотеки складываются
  const base = chain[0];
  const leaf = chain[chain.length - 1];
  const libs = [...(base.libraries || [])];
  for (let i = 1; i < chain.length; i++) libs.push(...(chain[i].libraries || []));

  // JVM-аргументы копятся от всех версий цепочки; игровые берём у наследника,
  // если он их реально задал (у Fabric массив game пустой — наследуются ванильные)
  let arguments_;
  if (leaf.arguments || base.arguments) {
    const game = (leaf.arguments && leaf.arguments.game && leaf.arguments.game.length)
      ? leaf.arguments.game
      : (base.arguments && base.arguments.game) || [];
    arguments_ = {
      jvm: [...((base.arguments && base.arguments.jvm) || []), ...((leaf.arguments && leaf.arguments.jvm) || [])],
      game,
    };
  }

  return {
    id: leaf.id,
    mainClass: leaf.mainClass || base.mainClass,
    assets: leaf.assets || base.assets,
    assetIndex: leaf.assetIndex || base.assetIndex,
    minecraftArguments: leaf.minecraftArguments || base.minecraftArguments,
    arguments: arguments_,
    libraries: libs,
    javaVersion: leaf.javaVersion || base.javaVersion,
    logging: leaf.logging || base.logging,
    downloads: leaf.downloads || base.downloads,
  };
}

async function buildClasspath(paths, chain, merged) {
  const parts = [];
  for (const lib of merged.libraries) {
    if (!isLibraryAllowed(lib)) continue;
    const art = libArtifactPath(lib);
    if (art && art.url) parts.push(path.join(paths.libraries(), art.dest));
  }
  // Клиентский jar берём из корневой (ванильной) версии — у загрузчиков его нет
  for (const meta of chain) {
    if (meta.downloads && meta.downloads.client) {
      parts.push(paths.versionJar(meta.id));
      break;
    }
  }
  return parts;
}

async function ensureNatives(paths, merged) {
  const ndir = paths.nativesDir(merged.id);
  let hasDll = false;
  try {
    const entries = await fsp.readdir(ndir);
    hasDll = entries.some(e => e.endsWith('.dll'));
  } catch { hasDll = false; }
  if (hasDll) return ndir;
  await ensureDir(ndir);
  for (const lib of merged.libraries) {
    if (!isLibraryAllowed(lib)) continue;
    // Нативы Windows: classifier (до 1.19) или отдельный артефакт ...:natives-windows (1.19+)
    if (lib.name && /:natives-windows(@\d+)?$/.test(lib.name)) {
      const art = libArtifactPath(lib);
      const dest = art && path.join(paths.libraries(), art.dest);
      if (dest && await exists(dest)) await extractNatives(dest, ndir);
      continue;
    }
    const nat = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers['natives-windows'];
    if (!nat) continue;
    const dest = path.join(paths.libraries(), nat.path);
    if (await exists(dest)) await extractNatives(dest, ndir);
  }
  return ndir;
}

function autoMemoryMb() {
  const totalMb = Math.round(os.totalmem() / 1024 / 1024);
  return Math.max(2048, Math.min(8192, Math.round(totalMb * 0.35 / 512) * 512));
}

function substitute(str, map) {
  return str.replace(/\$\{(\w+)\}/g, (_, k) => (k in map ? String(map[k]) : ''));
}

// Аргументы игры/VM как объект-карта подстановок
async function prepareLaunch(opts) {
  const { gameDir, versionId, account, cfg, width, height } = opts;
  const paths = await Paths.create(gameDir);
  const chain = await resolveChain(paths, versionId);
  const merged = mergeChains(chain);

  // Java
  progress({ phase: 'launch', label: 'Проверка Java', percent: 0.1 });
  const required = (merged.javaVersion && merged.javaVersion.majorVersion) || 8;
  const java = await javaMgr.resolveJava(gameDir, required, cfg);

  // Natives и classpath
  progress({ phase: 'launch', label: 'Проверка библиотек', percent: 0.35 });
  const nativesDir = await ensureNatives(paths, merged);
  const classpath = await buildClasspath(paths, chain, merged);
  for (const p of classpath) {
    if (!(await exists(p))) throw new Error('Отсутствует файл: ' + p + '\nПереустановите версию.');
  }

  // Папка игры: с подпапками по версиям (как в Legacy) или общая
  const workDir = cfg.subfoldersPerVersion
    ? path.join(gameDir, 'home', versionId)
    : gameDir;
  await ensureDir(workDir);
  for (const sub of ['resourcepacks', 'screenshots', 'logs']) await ensureDir(path.join(workDir, sub));

  // Моды и ресурспаки — всегда общие, в корне папки игры лаунчера.
  // При раздельных подпапках делаем junction-ссылки на корневые mods/resourcepacks
  // (работают на Windows без прав администратора).
  if (cfg.subfoldersPerVersion) {
    const shared = [
      ['mods', paths.mods()],
      ['resourcepacks', path.join(gameDir, 'resourcepacks')],
    ];
    for (const [name, target] of shared) {
      await ensureDir(target);
      const link = path.join(workDir, name);
      try {
        const st = await fsp.lstat(link).catch(() => null);
        if (!st) {
          await fsp.symlink(target, link, 'junction');
        } else if (!st.isSymbolicLink()) {
          // Старая локальная папка: переносим содержимое в общую, потом заменяем ссылкой
          const entries = await fsp.readdir(link).catch(() => []);
          if (entries.length) {
            for (const e of entries) {
              const dest = path.join(target, e);
              if (!(await exists(dest))) {
                await fsp.rename(path.join(link, e), dest).catch(async () => {
                  await fsp.cp(path.join(link, e), dest, { recursive: true }).catch(() => {});
                });
              }
            }
          }
          await fsp.rm(link, { recursive: true, force: true });
          await fsp.symlink(target, link, 'junction');
        }
      } catch { /* не удалось создать ссылку — игра использует локальную папку */ }
    }
  }

  const assetsRoot = paths.assets();
  const isLegacyAssets = merged.assets === 'legacy' || merged.assets === 'pre-1.6';
  const gameAssets = isLegacyAssets ? paths.virtualAssets(merged.assets) : undefined;

  const map = {
    auth_player_name: account.name,
    auth_uuid: account.uuid,
    auth_access_token: '0',
    auth_session: `token:0:${account.uuid}`,
    auth_xuid: '0',
    clientid: '0',
    user_type: 'legacy',
    user_properties: '{}',
    version_name: merged.id,
    profile_name: account.name,
    version_type: merged.type || 'release',
    game_directory: workDir,
    assets_root: assetsRoot,
    game_assets: gameAssets || assetsRoot,
    assets_index_name: merged.assets,
    natives_directory: nativesDir,
    launcher_name: 'Klim',
    launcher_version: '1.0.0',
    classpath: classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: paths.libraries(),
    resolution_width: width || '',
    resolution_height: height || '',
    quickPlayPath: '', quickPlaySingleplayer: '', quickPlayMultiplayer: '', quickPlayRealms: '',
  };

  // VM-аргументы
  const memMb = cfg.memory && cfg.memory.auto ? autoMemoryMb() : (cfg.memory ? cfg.memory.mb : 4096);
  const vmArgs = ['-Xmx' + memMb + 'M', '-Xms512M'];
  if (merged.logging && merged.logging.client) {
    const cfgPath = path.join(assetsRoot, 'log_configs', merged.logging.client.file.id);
    if (await exists(cfgPath)) vmArgs.push('-Dlog4j.configurationFile=' + cfgPath);
  }
  if (merged.arguments && merged.arguments.jvm) {
    for (const a of merged.arguments.jvm) {
      if (typeof a !== 'string') continue; // правила с фичами пропускаем
      vmArgs.push(substitute(a, map));
    }
  } else {
    vmArgs.push('-Djava.library.path=' + nativesDir);
    vmArgs.push('-cp', map.classpath);
  }
  vmArgs.push(merged.mainClass);

  // Аргументы игры
  const gameArgs = [];
  if (merged.arguments && merged.arguments.game) {
    for (const a of merged.arguments.game) {
      if (typeof a !== 'string') continue;
      gameArgs.push(substitute(a, map));
    }
  } else if (merged.minecraftArguments) {
    gameArgs.push(...merged.minecraftArguments.split(' ').map(a => substitute(a, map)));
  } else {
    gameArgs.push('--username', account.name, '--version', merged.id, '--gameDir', workDir,
      '--assetsDir', assetsRoot, '--assetIndex', merged.assets, '--uuid', account.uuid,
      '--accessToken', '0', '--userType', 'legacy');
  }
  // Фильтруем пустые
  const filtered = gameArgs.filter(a => a !== '' && a !== undefined);
  // Размер окна, если задан
  if (width && height && !filtered.includes('--width')) filtered.push('--width', String(width), '--height', String(height));

  return { javaPath: java.path, vmArgs, gameArgs: filtered, workDir, memMb };
}

async function launchGame(opts) {
  const prepared = await prepareLaunch(opts);
  taskState({ kind: 'launch', state: 'start' });
  progress({ phase: 'launch', label: 'Запуск игры', percent: 0.9 });

  if (opts.cfg.gpu) await applyGpuPreference(prepared.javaPath, opts.cfg.gpu).catch(() => {});

  const logPath = path.join(opts.gameDir, 'logs', 'latest-game.log');
  await ensureDir(path.dirname(logPath));
  const logStream = require('fs').createWriteStream(logPath, { flags: 'w' });
  const child = spawn(prepared.javaPath, [...prepared.vmArgs, ...prepared.gameArgs], {
    cwd: prepared.workDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  const sendLog = (buf) => {
    const line = buf.toString().trimEnd();
    if (line) logStream.write(line + '\n');
    taskState({ kind: 'game', state: 'log', line });
  };
  child.stdout.on('data', sendLog);
  child.stderr.on('data', sendLog);
  child.on('error', (e) => {
    taskState({ kind: 'game', state: 'error', message: 'Не удалось запустить java: ' + e.message });
  });
  child.on('close', (code) => {
    logStream.end();
    taskState({ kind: 'game', state: 'exit', code });
  });

  progress({ phase: 'launch', label: 'Игра запущена', percent: 1 });
  taskState({ kind: 'launch', state: 'done' });
  return { pid: child.pid, memMb: prepared.memMb, javaPath: prepared.javaPath, workDir: prepared.workDir };
}

module.exports = { launchGame, prepareLaunch, resolveChain };
