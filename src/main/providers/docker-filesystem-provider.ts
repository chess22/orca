import type { DockerEngineClientLike, DockerExecSession } from '../docker/docker-engine-client'
import { DockerEngineClient } from '../docker/docker-engine-client'
import type { DockerTarget } from '../docker/types'
import type { IFilesystemProvider, FileReadResult, FileStat } from './types'
import type { DirEntry, FsChangeEvent, SearchOptions, SearchResult } from '../../shared/types'

export class DockerFilesystemProvider implements IFilesystemProvider {
  private target: DockerTarget
  private engine: DockerEngineClientLike
  private watchListeners = new Map<string, (events: FsChangeEvent[]) => void>()
  private watchSessions = new Map<string, DockerExecSession>()

  constructor(target: DockerTarget, engine: DockerEngineClientLike = new DockerEngineClient()) {
    this.target = target
    this.engine = engine
  }

  getConnectionId(): string {
    return this.target.containerId
  }

  async readDir(dirPath: string): Promise<DirEntry[]> {
    return this.execNodeJson<DirEntry[]>(READ_DIR_SCRIPT, [dirPath])
  }

  async readFile(filePath: string): Promise<FileReadResult> {
    return this.execNodeJson<FileReadResult>(READ_FILE_SCRIPT, [filePath])
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.execNodeVoid(WRITE_FILE_SCRIPT, [filePath], content)
  }

  async stat(filePath: string): Promise<FileStat> {
    return this.execNodeJson<FileStat>(STAT_SCRIPT, [filePath])
  }

  async deletePath(targetPath: string, recursive?: boolean): Promise<void> {
    await this.execNodeVoid(DELETE_PATH_SCRIPT, [targetPath, recursive ? '1' : '0'])
  }

  async createFile(filePath: string): Promise<void> {
    await this.execNodeVoid(CREATE_FILE_SCRIPT, [filePath])
  }

  async createDir(dirPath: string): Promise<void> {
    await this.execNodeVoid(CREATE_DIR_SCRIPT, [dirPath])
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.execNodeVoid(RENAME_SCRIPT, [oldPath, newPath])
  }

  async copy(source: string, destination: string): Promise<void> {
    await this.execNodeVoid(COPY_SCRIPT, [source, destination])
  }

  async realpath(filePath: string): Promise<string> {
    return this.execNodeJson<string>(REALPATH_SCRIPT, [filePath])
  }

  async search(opts: SearchOptions): Promise<SearchResult> {
    return this.execNodeJson<SearchResult>(SEARCH_SCRIPT, [JSON.stringify(opts)])
  }

  async listFiles(rootPath: string, options?: { excludePaths?: string[] }): Promise<string[]> {
    return this.execNodeJson<string[]>(LIST_FILES_SCRIPT, [
      rootPath,
      JSON.stringify(options?.excludePaths ?? [])
    ])
  }

  async watch(rootPath: string, callback: (events: FsChangeEvent[]) => void): Promise<() => void> {
    this.watchListeners.set(rootPath, callback)
    const session = await this.engine.spawnExec({
      containerId: this.target.containerId,
      args: ['node', '-e', WATCH_SCRIPT, rootPath],
      cwd: rootPath,
      tty: false,
      cols: 80,
      rows: 24
    })
    this.watchSessions.set(rootPath, session)
    let buffer = ''
    session.onData((chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) {
          continue
        }
        callback(JSON.parse(line) as FsChangeEvent[])
      }
    })
    return () => {
      this.watchListeners.delete(rootPath)
      this.watchSessions.delete(rootPath)
      void session.shutdown(true)
    }
  }

  private async execNodeJson<T>(script: string, args: string[], input?: string): Promise<T> {
    const result = await this.engine.exec({
      containerId: this.target.containerId,
      args: ['node', '-e', script, ...args],
      cwd: this.target.workdir,
      input
    })
    return JSON.parse(result.stdout) as T
  }

  private async execNodeVoid(script: string, args: string[], input?: string): Promise<void> {
    await this.engine.exec({
      containerId: this.target.containerId,
      args: ['node', '-e', script, ...args],
      cwd: this.target.workdir,
      input
    })
  }
}

const READ_DIR_SCRIPT = `
const fs = require('fs');
const entries = fs.readdirSync(process.argv[1], { withFileTypes: true })
  .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), isSymlink: entry.isSymbolicLink() }))
  .sort((a, b) => a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name));
process.stdout.write(JSON.stringify(entries));
`
const READ_FILE_SCRIPT = `
const fs = require('fs');
const filePath = process.argv[1];
const buffer = fs.readFileSync(filePath);
const isBinary = buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
process.stdout.write(JSON.stringify({ content: isBinary ? '' : buffer.toString('utf8'), isBinary }));
`
const WRITE_FILE_SCRIPT = `
const fs = require('fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => fs.writeFileSync(process.argv[1], input, 'utf8'));
`
const STAT_SCRIPT = `
const fs = require('fs');
const stat = fs.lstatSync(process.argv[1]);
process.stdout.write(JSON.stringify({
  size: stat.size,
  type: stat.isDirectory() ? 'directory' : (stat.isSymbolicLink() ? 'symlink' : 'file'),
  mtime: stat.mtimeMs
}));
`
const DELETE_PATH_SCRIPT = `
const fs = require('fs');
fs.rmSync(process.argv[1], { recursive: process.argv[2] === '1', force: true });
`
const CREATE_FILE_SCRIPT = `
const fs = require('fs');
fs.closeSync(fs.openSync(process.argv[1], 'wx'));
`
const CREATE_DIR_SCRIPT = `
const fs = require('fs');
fs.mkdirSync(process.argv[1], { recursive: true });
`
const RENAME_SCRIPT = `
const fs = require('fs');
fs.renameSync(process.argv[1], process.argv[2]);
`
const COPY_SCRIPT = `
const fs = require('fs');
const stat = fs.lstatSync(process.argv[1]);
if (stat.isDirectory()) fs.cpSync(process.argv[1], process.argv[2], { recursive: true });
else fs.copyFileSync(process.argv[1], process.argv[2]);
`
const REALPATH_SCRIPT = `
const fs = require('fs');
process.stdout.write(JSON.stringify(fs.realpathSync(process.argv[1])));
`
const LIST_FILES_SCRIPT = `
const fs = require('fs');
const path = require('path');
const root = process.argv[1];
const excludes = new Set(JSON.parse(process.argv[2]));
const out = [];
function walk(dir) {
  if (excludes.has(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    if (excludes.has(abs)) continue;
    if (entry.isDirectory()) walk(abs);
    else out.push(path.relative(root, abs).replace(/\\\\/g, '/'));
  }
}
walk(root);
process.stdout.write(JSON.stringify(out.sort()));
`
const SEARCH_SCRIPT = `
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const opts = JSON.parse(process.argv[1]);
const max = opts.maxResults || 2000;
const files = new Map();
let totalMatches = 0;
function globToRegExp(pattern) {
  return new RegExp('^' + pattern.replace(/[.+^$(){}|[\\]\\\\]/g, '\\\\$&').replace(/\\*\\*/g, '.*').replace(/\\*/g, '[^/]*').replace(/\\?/g, '[^/]') + '$');
}
function patterns(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean).map(globToRegExp);
}
const includes = patterns(opts.includePattern);
const excludes = patterns(opts.excludePattern);
function rel(filePath) {
  return path.relative(opts.rootPath, filePath).replace(/\\\\/g, '/');
}
function allowed(filePath) {
  const relative = rel(filePath);
  return (includes.length === 0 || includes.some((p) => p.test(relative))) && !excludes.some((p) => p.test(relative));
}
function addMatch(filePath, match) {
  const relativePath = rel(filePath);
  const existing = files.get(filePath) || { filePath, relativePath, matches: [] };
  existing.matches.push(match);
  files.set(filePath, existing);
  totalMatches++;
}
function searchWithRg() {
  const args = ['--json', '--hidden', '--glob', '!.git', '--max-count', '100', '--max-filesize', '5M'];
  if (!opts.caseSensitive) args.push('--ignore-case');
  if (opts.wholeWord) args.push('--word-regexp');
  if (!opts.useRegex) args.push('--fixed-strings');
  for (const pat of String(opts.includePattern || '').split(',').map((s) => s.trim()).filter(Boolean)) args.push('--glob', pat);
  for (const pat of String(opts.excludePattern || '').split(',').map((s) => s.trim()).filter(Boolean)) args.push('--glob', '!' + pat);
  args.push('--', opts.query, opts.rootPath);
  const result = childProcess.spawnSync('rg', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.error) return false;
  for (const line of String(result.stdout || '').split(/\\n/)) {
    if (totalMatches >= max || !line) continue;
    const msg = JSON.parse(line);
    if (msg.type !== 'match') continue;
    const filePath = msg.data.path.text;
    if (!allowed(filePath)) continue;
    const lineContent = msg.data.lines.text.replace(/\\r?\\n$/, '');
    for (const sub of msg.data.submatches) {
      if (totalMatches >= max) break;
      addMatch(filePath, { line: msg.data.line_number, column: sub.start + 1, matchLength: sub.end - sub.start, lineContent });
    }
  }
  return true;
}
function visit(filePath) {
  if (totalMatches >= max) return;
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    if (path.basename(filePath) === '.git') return;
    for (const child of fs.readdirSync(filePath)) visit(path.join(filePath, child));
    return;
  }
  if (!allowed(filePath) || stat.size > 5 * 1024 * 1024) return;
  const text = fs.readFileSync(filePath, 'utf8');
  const matches = [];
  const lines = text.split(/\\r?\\n/);
  const flags = opts.caseSensitive ? 'g' : 'gi';
  const escaped = opts.useRegex ? opts.query : opts.query.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  const needle = new RegExp(opts.wholeWord ? '\\\\b(?:' + escaped + ')\\\\b' : escaped, flags);
  for (let i = 0; i < lines.length && totalMatches < max; i++) {
    for (const match of lines[i].matchAll(needle)) {
      if (match.index === undefined || totalMatches >= max) break;
      matches.push({ line: i + 1, column: match.index + 1, matchLength: match[0].length, lineContent: lines[i] });
      totalMatches += 1;
    }
  }
  if (matches.length) files.set(filePath, { filePath, relativePath: rel(filePath), matches });
}
try {
  if (!searchWithRg()) visit(opts.rootPath);
} catch {
  visit(opts.rootPath);
}
process.stdout.write(JSON.stringify({ files: Array.from(files.values()), totalMatches, truncated: totalMatches >= max }));
`
const WATCH_SCRIPT = `
const fs = require('fs');
const path = require('path');
const root = process.argv[1];
function snapshot(dir, out = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    const stat = fs.lstatSync(abs);
    out.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, isDirectory: stat.isDirectory() });
    if (entry.isDirectory()) snapshot(abs, out);
  }
  return out;
}
let previous = snapshot(root);
setInterval(() => {
  const next = snapshot(root);
  const events = [];
  for (const [abs, info] of next) {
    const old = previous.get(abs);
    if (!old) events.push({ kind: 'create', absolutePath: abs, isDirectory: info.isDirectory });
    else if (old.mtimeMs !== info.mtimeMs || old.size !== info.size) events.push({ kind: 'update', absolutePath: abs, isDirectory: info.isDirectory });
  }
  for (const [abs, info] of previous) {
    if (!next.has(abs)) events.push({ kind: 'delete', absolutePath: abs, isDirectory: info.isDirectory });
  }
  previous = next;
  if (events.length) process.stdout.write(JSON.stringify(events) + '\\n');
}, 500);
process.stdin.resume();
`
