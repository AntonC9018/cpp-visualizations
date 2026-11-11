// List the C++ examples the tracer could show, and tag the ones chosen by hand.
//
// Being traceable does not make an example worth a trace: a visualization earns its place only
// where watching memory change is what the example teaches. So nothing is tagged by default;
// the inventory lists candidates, and `--tag PATH:LINE` tags the ones a reader picked.
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applicable } from './generate.ts';
import { Unsupported, trace } from './tracing.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SUMMARIES: Record<string, string> = { en: 'Execution trace', ru: 'Выполнение по шагам' };
export const CPP_LANGUAGES = new Set(['cpp', 'c++', 'cxx']);

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const DETAILS = /<\/?details\b[^>]*>|<\/?visualization\b[^>]*>/gi;
const MENTIONS_TAG = /<\s*\/?\s*visualization\b/i;
const OPENING = /^<visualization(?:\s+template="([a-z][a-z0-9-]*)")?\s*>$/;
const CLOSING = /^<\/visualization\s*>$/i;
const BLOCK_BOUNDARY = /<\/?details\b|^ {0,3}(?:`{3,}|~{3,})/im;

export interface ScannedFence {
  source: string;
  start: number;
  end: number;
  depth: number;
  language: string;
  line: number;
}

export interface ScannedTag {
  start: number;
  end: number;
  line: number;
  template: string | null;
  source: ScannedFence;
  bodyStart: number;
  bodyEnd: number;
}

export interface ScannedDocument {
  fences: ScannedFence[];
  tags: ScannedTag[];
  errors: string[];
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSource(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function tagProblem(content: string, depth: number, source: ScannedFence | null): string | null {
  if (CLOSING.test(content)) {
    return 'closing visualization marker has no matching opening marker';
  }
  if (content.includes('<!--')) {
    return 'nested or unclosed visualization comment';
  }
  if (!OPENING.test(content)) {
    return 'expected <visualization> or <visualization template="name">';
  }
  if (depth === 0) {
    return 'visualization must be inside a details block';
  }
  if (source === null) {
    return 'no preceding source fence outside details';
  }
  if (!CPP_LANGUAGES.has(source.language)) {
    return 'nearest preceding outside-details fence must be C++';
  }
  return null;
}

function closingMarker(text: string, start: number): [number, number] | null {
  let cursor = start;
  while (true) {
    const comment = text.indexOf('<!--', cursor);
    const sliceEnd = comment < 0 ? text.length : comment;
    if (BLOCK_BOUNDARY.test(text.slice(cursor, sliceEnd))) {
      return null;
    }
    if (comment < 0) {
      return null;
    }
    const close = text.indexOf('-->', comment + 4);
    if (close < 0) {
      return null;
    }
    const content = text.slice(comment + 4, close).trim();
    if (CLOSING.test(content)) {
      return [comment, close + 3];
    }
    if (MENTIONS_TAG.test(content)) {
      return null;
    }
    cursor = close + 3;
  }
}

function splitLinesKeepEnds(text: string): string[] {
  const matches = text.match(/[^\n]*\n|[^\n]+/g);
  return matches ?? [];
}

function countNewlines(text: string, end: number): number {
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

export function scanDocument(text: string, path = '<markdown>'): ScannedDocument {
  const result: ScannedDocument = { fences: [], tags: [], errors: [] };
  let depth = 0;
  let fence: [string, number, number, number, string, number] | null = null;
  let lastSource: ScannedFence | null = null;
  let position = 0;
  const lines = splitLinesKeepEnds(text);
  let index = 0;

  function error(offset: number, message: string): void {
    result.errors.push(`${path}:${countNewlines(text, offset) + 1}: [VIS] ${message}`);
  }

  while (index < lines.length) {
    const line = lines[index];
    const plain = line.replace(/[\r\n]+$/, '');
    if (fence !== null) {
      const [marker, start, bodyStart, openDepth, language, openLine] = fence;
      const closeRe = new RegExp(`^ {0,3}${escapeRegExp(marker[0])}{${marker.length},}\\s*$`);
      if (closeRe.test(plain)) {
        const found: ScannedFence = {
          source: normalizeSource(text.slice(bodyStart, position)),
          start,
          end: position + line.length,
          depth: openDepth,
          language,
          line: openLine,
        };
        result.fences.push(found);
        if (openDepth === 0) {
          lastSource = found;
        }
        fence = null;
      }
      position += line.length;
      index += 1;
      continue;
    }

    const match = OPEN_FENCE.exec(plain);
    if (match) {
      const [, marker, info] = match;
      const trimmed = info.trim();
      const language = trimmed ? trimmed.split(/\s+/)[0].toLowerCase() : '';
      fence = [marker, position, position + line.length, depth, language, index + 1];
      position += line.length;
      index += 1;
      continue;
    }

    let cursor = position;
    let lineEnd = position + line.length;
    while (cursor < lineEnd) {
      const slice = text.slice(cursor, lineEnd);
      const commentRel = slice.indexOf('<!--');
      const comment = commentRel >= 0 ? cursor + commentRel : -1;
      DETAILS.lastIndex = 0;
      const detailMatch = DETAILS.exec(slice);
      const detailStart = detailMatch ? cursor + detailMatch.index : -1;
      const detailEnd = detailMatch ? detailStart + detailMatch[0].length : -1;

      if (comment >= 0 && (detailMatch === null || comment < detailStart)) {
        const close = text.indexOf('-->', comment + 4);
        if (close < 0) {
          if (MENTIONS_TAG.test(text.slice(comment))) {
            error(comment, 'unclosed visualization comment');
          }
          return result;
        }
        let finish = close + 3;
        const content = text.slice(comment + 4, close).trim();
        if (MENTIONS_TAG.test(content)) {
          let problem = tagProblem(content, depth, lastSource);
          const closing = problem ? null : closingMarker(text, finish);
          if (!problem && closing === null) {
            problem =
              'opening marker needs a closing <!-- </visualization> --> before the next block';
          }
          if (problem) {
            error(comment, problem);
            if (problem.startsWith('nested')) {
              return result;
            }
          } else if (closing !== null && lastSource !== null) {
            const openMatch = OPENING.exec(content);
            result.tags.push({
              start: comment,
              end: closing[1],
              line: countNewlines(text, comment) + 1,
              template: openMatch?.[1] ?? null,
              source: lastSource,
              bodyStart: finish,
              bodyEnd: closing[0],
            });
            finish = closing[1];
          }
        }
        cursor = finish;
        if (finish > lineEnd) {
          while (index < lines.length && position + lines[index].length < finish) {
            position += lines[index].length;
            index += 1;
          }
          lineEnd = index < lines.length ? position + lines[index].length : text.length;
        }
      } else if (detailMatch !== null) {
        if (MENTIONS_TAG.test(detailMatch[0])) {
          error(detailStart, 'visualization marker must be inside an HTML comment');
        } else if (detailMatch[0].startsWith('</')) {
          depth = Math.max(0, depth - 1);
        } else {
          depth += 1;
        }
        cursor = detailEnd;
      } else {
        break;
      }
    }
    if (index >= lines.length) {
      break;
    }
    position += lines[index].length;
    index += 1;
  }
  if (fence !== null && result.tags.length > 0) {
    result.errors.push(`${path}:${fence[5]}: [VIS] unclosed code fence after a visualization`);
  }
  return result;
}

function hasClang(): boolean {
  if (process.env.CLANGXX) return true;
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      accessSync(join(dir, 'clang++'), constants.X_OK);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

function walkMarkdownFiles(
  dir: string,
  repoReal: string,
  out: Set<string>,
  visitedDirs: Set<string> = new Set()
): void {
  const realDir = realpathSync(dir);
  if (!realDir.startsWith(repoReal + sep) && realDir !== repoReal) {
    throw new Error(`${dir}: [VIS] source symlink escapes repository`);
  }
  if (visitedDirs.has(realDir)) return;
  visitedDirs.add(realDir);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkMarkdownFiles(full, repoReal, out, visitedDirs);
    } else if (st.isFile() && entry.name.endsWith('.md')) {
      const resolved = realpathSync(full);
      if (!resolved.startsWith(repoReal + sep) && resolved !== repoReal) {
        throw new Error(`${full}: [VIS] source symlink escapes repository`);
      }
      out.add(full);
    }
  }
}

export interface SelectedCandidate {
  path: string;
  line: number;
  source: string;
  already_tagged: boolean;
}

export interface SkippedCandidate {
  path: string;
  line: number;
  source: string;
  reason: string;
}

export interface DiscoveryReport {
  selected: SelectedCandidate[];
  skipped: SkippedCandidate[];
  unique_supported_sources: number;
  skip_reasons: Record<string, number>;
}

interface CoursePublishingConfig {
  visualizations?: {
    roots?: string[];
  };
  languages?: Array<{ code: string; root: string }>;
}

export function discover(
  repo: string,
  { tag = [] }: { tag?: string[] } = {}
): DiscoveryReport {
  if (!hasClang()) {
    throw new Error('Clang is required for discovery; put clang++ on PATH or set CLANGXX');
  }
  const configPath = join(repo, 'course-publishing.json');
  if (!existsSync(configPath)) {
    throw new Error(`missing course configuration: ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as CoursePublishingConfig;
  if (!config.visualizations || !Array.isArray(config.visualizations.roots)) {
    throw new Error('configure visualizations in course-publishing.json first');
  }
  const repoReal = realpathSync(repo);
  const filesSet = new Set<string>();
  for (const root of config.visualizations.roots) {
    const rootDir = resolve(repo, root);
    if (existsSync(rootDir)) {
      walkMarkdownFiles(rootDir, repoReal, filesSet);
    }
  }
  const files = [...filesSet].sort();

  const cache = new Map<string, string | null>();
  const selected: SelectedCandidate[] = [];
  const skipped: SkippedCandidate[] = [];
  const pending = new Set(tag);
  const edited = new Map<string, string>();

  for (const path of files) {
    let original = readFileSync(path, 'utf8');
    const scanned = scanDocument(original, path);
    if (scanned.errors.length > 0) {
      throw new Error(scanned.errors.join('\n'));
    }
    const tagged = new Set(scanned.tags.map(t => t.source.start));
    const insertions: Array<[number, string]> = [];
    for (const fence of scanned.fences) {
      if (fence.depth || !CPP_LANGUAGES.has(fence.language)) {
        continue;
      }
      if (!cache.has(fence.source)) {
        try {
          applicable(trace(fence.source, { runtime: false }), fence.source);
          cache.set(fence.source, null);
        } catch (exc) {
          if (exc instanceof Unsupported) {
            cache.set(fence.source, exc.message);
          } else {
            throw exc;
          }
        }
      }
      const reason = cache.get(fence.source) ?? null;
      const relPosix = relative(repo, path).split(sep).join('/');
      const entry = { path: relPosix, line: fence.line, source: fence.source };
      if (reason) {
        skipped.push({ ...entry, reason });
        continue;
      }
      selected.push({ ...entry, already_tagged: tagged.has(fence.start) });
      const chosen = `${entry.path}:${fence.line}`;
      if (tagged.has(fence.start) || !pending.has(chosen)) {
        continue;
      }
      pending.delete(chosen);
      const language =
        (config.languages || []).find(lang => {
          const langRoot = resolve(repo, lang.root);
          return path.startsWith(langRoot + sep) || path === langRoot;
        })?.code ?? 'en';
      const summary = SUMMARIES[language] ?? SUMMARIES.en;
      const tail = original.slice(fence.end);
      const after = tail.startsWith('\n') || tail.startsWith('\r\n') ? '' : '\n';
      insertions.push([
        fence.end,
        `\n<details>\n<summary>${summary}</summary>\n\n` +
          `<!-- <visualization> -->\n\n` +
          `<!-- </visualization> -->\n\n</details>\n` +
          after,
      ]);
    }
    for (let i = insertions.length - 1; i >= 0; i--) {
      const [at, markup] = insertions[i];
      original = original.slice(0, at) + markup + original.slice(at);
    }
    if (insertions.length > 0) {
      edited.set(path, original);
    }
  }
  if (pending.size > 0) {
    throw new Error('not an untagged candidate: ' + [...pending].sort().join(', '));
  }
  for (const [path, text] of edited.entries()) {
    writeFileSync(path, text);
  }
  const skipReasons: Record<string, number> = {};
  for (const entry of skipped) {
    skipReasons[entry.reason] = (skipReasons[entry.reason] ?? 0) + 1;
  }
  let uniqueSupportedSources = 0;
  for (const reason of cache.values()) {
    if (reason === null) uniqueSupportedSources++;
  }
  return {
    selected,
    skipped,
    unique_supported_sources: uniqueSupportedSources,
    skip_reasons: skipReasons,
  };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let courseRepo = ROOT;
  const tag: string[] = [];
  let reportPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--course-repo') {
      courseRepo = resolve(argv[++i]);
    } else if (arg === '--report') {
      reportPath = resolve(argv[++i]);
    } else if (arg === '--tag') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        tag.push(argv[++i]);
      }
    } else {
      console.error(`error: unrecognized argument ${arg}`);
      return 1;
    }
  }

  let report: DiscoveryReport;
  try {
    report = discover(resolve(courseRepo), { tag });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    console.error(`error: ${message}`);
    return 1;
  }
  const tagSet = new Set(tag);
  for (const entry of report.selected) {
    const key = `${entry.path}:${entry.line}`;
    console.log(`${key}: ${entry.already_tagged || tagSet.has(key) ? 'tagged' : 'candidate'}`);
  }
  console.log(
    `${report.selected.length} traceable examples; ${report.unique_supported_sources} shared assets`
  );
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  return 0;
}
