// Генерация иконки лаунчера: неоновая «K» → PNG разных размеров + .ico
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<body></body>');

  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const SIZES = ${JSON.stringify(SIZES)};
    const out = {};
    for (const s of SIZES) {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const ctx = c.getContext('2d');
      drawIcon(ctx, s);
      out[s] = c.toDataURL('image/png');
    }
    return out;

    function drawIcon(ctx, s) {
      // Скруглённый тёмно-фиолетовый фон
      const r = s * 0.22;
      ctx.beginPath();
      roundRect(ctx, 0.5, 0.5, s - 1, s - 1, r);
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, '#1a0b33');
      g.addColorStop(1, '#0d0716');
      ctx.fillStyle = g;
      ctx.fill();
      // Свечение и буква рисуем только внутри скругления
      ctx.clip();

      // Мягкое свечение позади буквы
      ctx.shadowColor = '#c233ff';
      ctx.shadowBlur = s * 0.22;

      // Неоновая буква K
      const grad = ctx.createLinearGradient(0, s * 0.15, s, s * 0.9);
      grad.addColorStop(0, '#b049ff');
      grad.addColorStop(1, '#ff4ecd');
      ctx.strokeStyle = grad;
      ctx.lineWidth = s * 0.115;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const m = s * 0.28;
      ctx.beginPath();
      ctx.moveTo(m, m * 0.82);
      ctx.lineTo(m, s - m * 0.82);
      ctx.moveTo(s - m * 0.92, m * 0.9);
      ctx.lineTo(m, s * 0.52);
      ctx.moveTo(m, s * 0.52);
      ctx.lineTo(s - m * 0.92, s - m * 0.9);
      ctx.stroke();
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  })()`);

  const buildDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  for (const [s, dataUrl] of Object.entries(pngs)) {
    fs.writeFileSync(path.join(buildDir, `icon-${s}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  const pngToIco = require('png-to-ico');
  const icoSources = SIZES.filter(s => s <= 256).map(s => path.join(buildDir, `icon-${s}.png`));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), await pngToIco(icoSources));
  fs.copyFileSync(path.join(buildDir, 'icon-256.png'), path.join(buildDir, 'icon.png'));
  console.log('Иконки созданы: build/icon.ico, build/icon.png');
  app.quit();
}).catch(err => { console.error(err); app.exit(1); });
