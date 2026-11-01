// Разбор составных идентификаторов версий: fabric-loader-<l>-<mc>, forge-<mc>-<b>
function fabricLoaderFromId(id) {
  const m = /^fabric-loader-([^-]+)-(.+)$/.exec(id);
  if (!m) return null;
  return { loader: m[1], mcId: m[2] };
}

function forgeLoaderFromId(id) {
  const m = /^forge-(.+)$/.exec(id);
  if (!m) return null;
  const rest = m[1];
  // forge-1.20.1-47.2.0 → mcId 1.20.1; forge-1.7.10-10.13.4.1614-1.7.10 (старые сборки) — берём первый сегмент как mc
  const firstDash = rest.indexOf('-');
  if (firstDash === -1) return null;
  return { loader: rest, mcId: rest.slice(0, firstDash) };
}

// Базовая ванильная версия из составного id
function baseMcFromId(id) {
  const f = fabricLoaderFromId(id);
  if (f) return f.mcId;
  const g = forgeLoaderFromId(id);
  if (g) return g.mcId;
  return id;
}

module.exports = { fabricLoaderFromId, forgeLoaderFromId, baseMcFromId };
