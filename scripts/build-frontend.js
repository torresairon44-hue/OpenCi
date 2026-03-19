const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');
const terser = require('terser');
const { minify } = require('html-minifier-terser');
const CleanCSS = require('clean-css');

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, 'public');
const outDir = path.join(projectRoot, 'dist', 'public');
const outAssetsDir = path.join(outDir, 'assets');
const defaultDomainLockHosts = ['localhost', '127.0.0.1', '8ls7rp4r-3000.asse.devtunnels.ms'];

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyPublicAssets() {
  const skip = new Set(['index.html', 'script.js', 'styles.css']);
  const entries = fs.readdirSync(publicDir, { withFileTypes: true });

  for (const entry of entries) {
    if (skip.has(entry.name)) continue;

    const srcPath = path.join(publicDir, entry.name);
    const dstPath = path.join(outDir, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(srcPath, dstPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

async function buildFrontend() {
  ensureDir(outDir);
  ensureDir(outAssetsDir);

  const configuredDomainLockHosts = (process.env.DOMAIN_LOCK_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const domainLockHosts = configuredDomainLockHosts.length > 0
    ? configuredDomainLockHosts
    : defaultDomainLockHosts;

  const jsBundleResult = await esbuild.build({
    entryPoints: [path.join(publicDir, 'script.js')],
    bundle: true,
    minify: false,
    sourcemap: false,
    write: false,
    platform: 'browser',
    target: ['es2019'],
    legalComments: 'none',
  });

  const bundledJs = jsBundleResult.outputFiles[0].text;
  const terserResult = await terser.minify(bundledJs, {
    compress: true,
    mangle: true,
    format: {
      comments: false,
    },
    sourceMap: false,
  });

  if (!terserResult.code) {
    throw new Error('Terser minification failed for frontend bundle');
  }

  const obfuscatedJs = JavaScriptObfuscator.obfuscate(terserResult.code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: false,
    debugProtection: true,
    debugProtectionInterval: 2000,
    disableConsoleOutput: true,
    domainLock: domainLockHosts,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
  }).getObfuscatedCode();

  const jsHash = hashContent(obfuscatedJs);
  const jsFileName = `app.${jsHash}.js`;
  const jsOutputPath = path.join(outAssetsDir, jsFileName);
  fs.writeFileSync(jsOutputPath, obfuscatedJs, 'utf8');

  const rawCss = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  const minifiedCss = new CleanCSS({ level: 2 }).minify(rawCss).styles;
  const cssHash = hashContent(minifiedCss);
  const cssFileName = `app.${cssHash}.css`;
  const cssOutputPath = path.join(outAssetsDir, cssFileName);
  fs.writeFileSync(cssOutputPath, minifiedCss, 'utf8');

  const rawHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const rewrittenHtml = rawHtml
    .replace('href="styles.css"', `href="assets/${cssFileName}"`)
    .replace('src="script.js"', `src="assets/${jsFileName}" defer`);

  const minifiedHtml = await minify(rewrittenHtml, {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeOptionalTags: false,
    removeEmptyAttributes: true,
    minifyCSS: true,
    minifyJS: false,
  });

  fs.writeFileSync(path.join(outDir, 'index.html'), minifiedHtml, 'utf8');
  copyPublicAssets();

  console.log(`Frontend build complete:`);
  console.log(`- JS: assets/${jsFileName}`);
  console.log(`- CSS: assets/${cssFileName}`);
  console.log(`- HTML: dist/public/index.html`);
  console.log(`- Domain lock hosts: ${domainLockHosts.join(', ')}`);
}

buildFrontend().catch((error) => {
  console.error('Frontend build failed:', error);
  process.exit(1);
});
