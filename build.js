/* Сборка одностраничного index.html:
 * - встраивает engine.js и peerjs
 * - собирает стикеры из папки stickers/ (png/jpg/webp), сжимает до 96×96
 *   и вшивает их в игру как стандартный набор.
 * Запуск: npm install (один раз), затем node build.js
 */
const fs = require('fs');
const path = require('path');

async function buildStickers() {
  const dir = path.join(__dirname, 'stickers');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpe?g|webp|bmp|gif)$/i.test(f))
    .sort();
  if (files.length === 0) return [];
  let Jimp;
  try { Jimp = require('jimp'); } catch (e) {
    console.error('Нет пакета jimp — выполни: npm install');
    process.exit(1);
  }
  const out = [];
  for (const f of files) {
    try {
      const img = await Jimp.read(path.join(dir, f));
      img.cover(96, 96).quality(80);
      const b64 = await img.getBase64Async(Jimp.MIME_JPEG);
      if (b64.length > 40000) { console.warn('Пропущен (слишком сложный):', f); continue; }
      out.push(b64);
      console.log('стикер:', f, Math.round(b64.length / 1024) + 'КБ');
    } catch (e) {
      console.warn('Не удалось обработать', f, '-', e.message);
    }
  }
  return out;
}

(async () => {
  const engine = fs.readFileSync('engine.js', 'utf8');
  const peerjs = fs.readFileSync('node_modules/peerjs/dist/peerjs.min.js', 'utf8');
  const profiles = fs.readFileSync('profiles.js', 'utf8');
  // бандл Firebase SDK: пересобирается командой `node build-fb.js`, лежит в репозитории
  const firebase = fs.existsSync('fb.min.js') ? fs.readFileSync('fb.min.js', 'utf8') : '';
  const tpl = fs.readFileSync('ui.template.html', 'utf8');
  const stickers = await buildStickers();
  const stickersJs = 'const BUILTIN_STICKERS = ' + JSON.stringify(stickers) + ';';
  fs.writeFileSync('index.html', tpl
    .replace('//__FIREBASE__//', () => firebase)
    .replace('//__PROFILES__//', () => profiles)
    .replace('//__PEERJS__//', () => peerjs)
    .replace('//__ENGINE__//', () => engine)
    .replace('//__STICKERS__//', () => stickersJs));
  console.log('index.html собран,', fs.statSync('index.html').size, 'байт, стикеров:', stickers.length, firebase ? '(с Firebase)' : '(без Firebase!)');
})();
