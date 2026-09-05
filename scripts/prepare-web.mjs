import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const entries = await readdir(root, { withFileTypes: true });
const candidates = entries
  .filter((entry) => entry.isFile() && /^Sudoku .*\.html$/i.test(entry.name))
  .map((entry) => entry.name);

if (candidates.length !== 1) {
  throw new Error(
    `Expected exactly one root Sudoku HTML file, found ${candidates.length}: ${candidates.join(', ') || '(none)'}`,
  );
}

const webDir = resolve(root, 'www');
await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
await copyFile(resolve(root, candidates[0]), resolve(webDir, 'index.html'));

console.log(`Prepared mobile web assets from ${candidates[0]} -> www/index.html`);
