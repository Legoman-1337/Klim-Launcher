// Оффлайн-аккаунты: список ников + UUID как в ванильном оффлайне
const { offlineUuid } = require('./util');

function listAccounts(cfg) {
  return cfg.accounts;
}

function addAccount(cfg, nickname) {
  const name = String(nickname || '').trim().slice(0, 16);
  if (!/^[\w\d_]{2,16}$/.test(name)) throw new Error('Ник должен быть 2–16 символов: буквы, цифры, подчёркивание');
  if (!cfg.accounts.list.some(a => a.name === name)) {
    cfg.accounts.list.push({ name, uuid: offlineUuid(name), type: 'offline' });
  }
  cfg.accounts.selected = name;
  return cfg.accounts;
}

function removeAccount(cfg, name) {
  cfg.accounts.list = cfg.accounts.list.filter(a => a.name !== name);
  if (cfg.accounts.selected === name) {
    cfg.accounts.selected = cfg.accounts.list.length ? cfg.accounts.list[0].name : null;
  }
  return cfg.accounts;
}

function selectAccount(cfg, name) {
  if (!cfg.accounts.list.some(a => a.name === name)) throw new Error('Аккаунт не найден: ' + name);
  cfg.accounts.selected = name;
  return cfg.accounts;
}

function currentAccount(cfg) {
  const name = cfg.accounts.selected || (cfg.accounts.list.length ? cfg.accounts.list[0].name : null);
  if (!name) return null;
  return cfg.accounts.list.find(a => a.name === name);
}

module.exports = { listAccounts, addAccount, removeAccount, selectAccount, currentAccount };
