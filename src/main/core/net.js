// Сетевой слой: скачивание с прогрессом, ретраями и параллельной очередью
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');
const http = require('http');
const path = require('path');

const UA = 'Klim-Launcher/1.0';

function request(url, headers = {}, redirects = 0, tls12 = false) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Слишком много перенаправлений: ' + url));
    const mod = url.startsWith('https:') ? https : http;
    const options = { headers: { 'User-Agent': UA, ...headers } };
    // Часть сетей/DPI сбрасывает TLS 1.3 — повторяем на TLS 1.2
    if (url.startsWith('https:') && tls12) options.maxVersion = 'TLSv1.2';
    const req = mod.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(request(new URL(res.headers.location, url).toString(), headers, redirects + 1, tls12));
      }
      resolve(res);
    });
    req.on('error', (e) => {
      if (!tls12 && (e.code === 'ECONNRESET' || e.code === 'EPROTO')) {
        request(url, headers, redirects, true).then(resolve, reject);
      } else reject(e);
    });
    req.setTimeout(30000, () => req.destroy(new Error('Таймаут: ' + url)));
  });
}

function checkStatus(res, url) {
  if (res.statusCode !== 200 && res.statusCode !== 206) {
    res.resume();
    throw new Error('HTTP ' + res.statusCode + ' для ' + url);
  }
  return res;
}

async function fetchJson(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try { return JSON.parse(await fetchText(url, 1)); }
    catch (e) {
      if (i >= attempts) throw e;
      await new Promise(r => setTimeout(r, 700 * i));
    }
  }
}

async function fetchText(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = checkStatus(await request(url), url);
      const chunks = [];
      for await (const c of res) chunks.push(c);
      return Buffer.concat(chunks).toString('utf8');
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise(r => setTimeout(r, 700 * i));
    }
  }
}

// Скачивание файла с докачкой и ретраями
async function downloadFile(url, dest, onBytes, attempts = 3) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.klim-part';
  for (let i = 1; i <= attempts; i++) {
    let start = 0;
    try {
      const st = await fsp.stat(tmp);
      start = st.size;
    } catch { start = 0; }
    try {
      const headers = start > 0 ? { Range: 'bytes=' + start + '-' } : {};
      const res = checkStatus(await request(url, headers), url);
      let known = 0;
      if (res.statusCode === 206) {
        const m = /\/(\d+)$/.exec(res.headers['content-range'] || '');
        known = m ? Number(m[1]) : 0;
      } else {
        known = Number(res.headers['content-length'] || 0);
        start = 0; // сервер не поддержал докачку
      }
      const ws = fs.createWriteStream(tmp, start > 0 ? { flags: 'a' } : { flags: 'w' });
      let received = start;
      res.on('data', (c) => {
        received += c.length;
        if (onBytes) onBytes(received, known);
      });
      await new Promise((resolve, reject) => {
        res.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        res.on('error', reject);
      });
      await fsp.rename(tmp, dest);
      return;
    } catch (e) {
      if (i === attempts) throw e;
      await new Promise(r => setTimeout(r, 800 * i));
    }
  }
}

// Параллельная очередь: tasks = [{ label, run: async (progressCb) => {}, weight }]
// progressCb: (received, total)
async function runQueue(tasks, concurrency, onProgress, isCancelled = () => false) {
  const total = tasks.reduce((s, t) => s + (t.weight || 1), 0);
  let done = 0;
  let idx = 0;
  const report = () => {
    if (onProgress) onProgress(Math.min(1, done / total));
  };
  const worker = async () => {
    while (idx < tasks.length && !isCancelled()) {
      const t = tasks[idx++];
      try {
        await t.run((received, size) => {
          const frac = size ? Math.min(1, received / size) : 0;
          if (onProgress) onProgress(Math.min(1, (done + (t.weight || 1) * frac) / total));
        });
      } finally {
        done += t.weight || 1;
        report();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
}

module.exports = { fetchJson, fetchText, downloadFile, runQueue, request };
