/* Сборка одностраничного index.html: встраивает engine.js и peerjs в шаблон UI */
const fs = require('fs');
const engine = fs.readFileSync('engine.js', 'utf8');
const peerjs = fs.readFileSync('node_modules/peerjs/dist/peerjs.min.js', 'utf8');
const tpl = fs.readFileSync('ui.template.html', 'utf8');
fs.writeFileSync('index.html', tpl
  .replace('//__PEERJS__//', () => peerjs)
  .replace('//__ENGINE__//', () => engine));
console.log('index.html собран,', fs.statSync('index.html').size, 'байт');
