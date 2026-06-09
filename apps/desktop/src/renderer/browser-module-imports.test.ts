import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const VALUE_IMPORT_PATTERN = /\b(?:import|export)\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

function getRendererSourceFiles(): string[] {
  return readdirSync('src/renderer')
    .filter((fileName) => fileName.endsWith('.ts'))
    .filter((fileName) => !fileName.endsWith('.test.ts'))
    .filter((fileName) => !fileName.endsWith('.d.ts'))
    .map((fileName) => join('src/renderer', fileName));
}

describe('renderer browser module imports', () => {
  it('uses browser-loadable extensions for value imports', () => {
    const extensionlessImports = getRendererSourceFiles().flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      const matches = [...source.matchAll(VALUE_IMPORT_PATTERN)];

      return matches
        .map((match) => match[1])
        .filter((specifier) => !specifier.endsWith('.js'))
        .map((specifier) => `${filePath}: ${specifier}`);
    });

    expect(extensionlessImports).toEqual([]);
  });
});
