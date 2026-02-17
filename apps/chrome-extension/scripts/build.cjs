const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const srcDir = path.join(rootDir, 'src');

function runTypeScriptBuild() {
  const tscCliPath = require.resolve('typescript/bin/tsc', { paths: [rootDir] });
  const result = spawnSync(process.execPath, [tscCliPath, '-p', path.join(rootDir, 'tsconfig.json')], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error('TypeScript compilation failed for Chrome extension.');
  }
}

function copyStaticAsset(relativePath) {
  const fromPath = path.join(srcDir, relativePath);
  const toPath = path.join(distDir, relativePath);
  const stat = fs.statSync(fromPath);

  if (stat.isDirectory()) {
    fs.cpSync(fromPath, toPath, { recursive: true });
    return;
  }

  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

runTypeScriptBuild();

fs.copyFileSync(path.join(rootDir, 'manifest.json'), path.join(distDir, 'manifest.json'));
copyStaticAsset('options.html');
copyStaticAsset('options.css');
copyStaticAsset('icons');

console.log('Built Chrome extension into apps/chrome-extension/dist');
