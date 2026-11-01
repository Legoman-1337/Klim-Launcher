// Общие утилиты для главного процесса
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readJson(p) {
  return JSON.parse(await fsp.readFile(p, 'utf8'));
}

async function writeJson(p, data) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

// UUID как у ванильного оффлайн-режима: UUID.nameUUIDFromBytes("OfflinePlayer:" + name)
function offlineUuid(nickname) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + nickname, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // версия 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // вариант IETF
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' МБ';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
}

// Безопасное удаление папки (только внутри заданного корня)
async function removeDir(dir, root) {
  const norm = path.resolve(dir);
  const r = path.resolve(root);
  if (!norm.startsWith(r)) throw new Error('Отказ удаления: путь вне корня ' + root);
  await fsp.rm(norm, { recursive: true, force: true });
}

module.exports = { fs, fsp, path, ensureDir, exists, readJson, writeJson, md5, offlineUuid, formatBytes, removeDir };
