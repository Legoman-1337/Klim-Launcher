// Шина событий главного процесса: прогресс установки, статусы запуска
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

// progress: { phase, label, percent, received, total, speed, eta }
function progress(p) { bus.emit('progress', p); }
function taskState(s) { bus.emit('task', s); } // { kind: 'install'|'launch'|'game', state: 'start'|'done'|'error', ... }

module.exports = { bus, progress, taskState };
