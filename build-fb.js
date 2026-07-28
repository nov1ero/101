/* Сборка бандла Firebase SDK → fb.min.js (запускать при обновлении firebase) */
const esbuild = require('esbuild');
esbuild.buildSync({
  entryPoints: ['fb-entry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: 'fb.min.js',
  logLevel: 'warning',
});
console.log('fb.min.js собран,', require('fs').statSync('fb.min.js').size, 'байт');
