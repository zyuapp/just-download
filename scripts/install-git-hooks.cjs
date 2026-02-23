const fs = require('fs');
const path = require('path');

const MARKER = '# just-download managed pre-commit hook';
const rootDir = path.resolve(__dirname, '..');
const hooksDir = path.join(rootDir, '.git', 'hooks');
const hookPath = path.join(hooksDir, 'pre-commit');

function installPreCommitHook() {
  if (!fs.existsSync(hooksDir)) {
    console.log('[hooks] Skipping install: .git/hooks not found.');
    return;
  }

  if (fs.existsSync(hookPath)) {
    const current = fs.readFileSync(hookPath, 'utf8');
    if (!current.includes(MARKER)) {
      console.log('[hooks] Skipping install: existing pre-commit hook is user-managed.');
      return;
    }
  }

  const content = [
    '#!/bin/sh',
    MARKER,
    'set -e',
    'REPO_ROOT="$(git rev-parse --show-toplevel)"',
    'cd "$REPO_ROOT"',
    'npm run precommit:verify'
  ].join('\n');

  fs.writeFileSync(hookPath, `${content}\n`, 'utf8');
  fs.chmodSync(hookPath, 0o755);
  console.log('[hooks] Installed pre-commit hook.');
}

installPreCommitHook();
