#!/usr/bin/env node
/**
 * Extracts every fenced Mermaid block in the repository and runs
 * `mermaid.parse()` over it (spec/README.md § Diagrams).
 *
 * Mermaid's failure mode is a silently empty block, so an unparsed diagram is a
 * blank space where the reader expected the explanation. CI fails on any error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage', '.backups']);
const FENCE = /```mermaid\r?\n([\s\S]*?)```/g;

function markdownFiles(dir) {
  const found = [];

  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;

    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
    else if (entry.endsWith('.md')) found.push(path);
  }

  return found;
}

/** Mermaid's parser needs a DOM even when it renders nothing. */
function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  // Node 21+ defines a getter-only `navigator`, so it has to be redefined.
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  globalThis.DOMPurify = undefined;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
}

installDom();
const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

let blocks = 0;
const failures = [];

for (const file of markdownFiles(ROOT)) {
  const source = readFileSync(file, 'utf8');
  const lineOf = (index) => source.slice(0, index).split('\n').length;

  for (const match of source.matchAll(FENCE)) {
    blocks += 1;
    const diagram = match[1].trim();
    const where = `${relative(ROOT, file)}:${lineOf(match.index)}`;

    if (diagram.length === 0) {
      failures.push(`${where} — empty mermaid block`);
      continue;
    }

    try {
      await mermaid.parse(diagram);
    } catch (error) {
      failures.push(`${where} — ${(error?.message ?? String(error)).split('\n')[0]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${blocks} Mermaid blocks failed to parse:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`All ${blocks} Mermaid blocks parse.`);
