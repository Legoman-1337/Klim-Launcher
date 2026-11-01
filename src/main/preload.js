// Мост между рендерером и главным процессом
const { contextBridge, ipcRenderer } = require('electron');

const EVENT_CHANNELS = ['progress', 'task', 'confirm:closeDuringInstall'];

contextBridge.exposeInMainWorld('klim', {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
    pickBackground: () => ipcRenderer.invoke('dialog:pickBackground'),
  },
  versions: {
    list: (filters) => ipcRenderer.invoke('versions:list', filters),
    local: () => ipcRenderer.invoke('versions:local'),
    loadersFor: (mcId) => ipcRenderer.invoke('loaders:for', mcId),
    install: (id) => ipcRenderer.invoke('versions:install', id),
    remove: (id) => ipcRenderer.invoke('versions:remove', id),
  },
  java: {
    list: () => ipcRenderer.invoke('java:list'),
    install: (feature) => ipcRenderer.invoke('java:install', feature),
  },
  accounts: {
    add: (name) => ipcRenderer.invoke('accounts:add', name),
    remove: (name) => ipcRenderer.invoke('accounts:remove', name),
    select: (name) => ipcRenderer.invoke('accounts:select', name),
  },
  launch: {
    start: (opts) => ipcRenderer.invoke('launch:start', opts),
  },
  install: {
    cancel: () => ipcRenderer.send('install:cancel'),
  },
  fs: {
    open: (kind) => ipcRenderer.invoke('fs:open', kind),
  },
  on: (channel, cb) => {
    if (!EVENT_CHANNELS.includes(channel)) return () => {};
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
