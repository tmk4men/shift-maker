/* build-www.mjs — Capacitor に渡す www/ を作る。
   実行時に必要なファイルだけを集める（テスト・ナレッジ・node_modules は入れない）。
   Web版（GitHub Pages）は従来どおりリポジトリ直下をそのまま使う。ここは iOS 用の複製。 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'www');

// 同梱するもの（アプリの動作に必要な実体だけ）
const FILES = ['index.html'];
const DIRS = ['css', 'js', 'assets'];

// アプリに入れないもの（素材の元データ・作業ファイル）
const SKIP = new Set(['app-icon-src.png']);

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  for (const f of FILES) {
    await fs.copyFile(path.join(ROOT, f), path.join(OUT, f));
  }
  for (const dir of DIRS) {
    const src = path.join(ROOT, dir);
    try { await fs.access(src); } catch { continue; }
    await copyDir(src, path.join(OUT, dir));
  }

  // 端末内で完結するアプリなので、ネットワーク不要。念のため確認用の一覧を出す。
  const list = [];
  async function walk(dir, rel) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else list.push(r.replace(/\\/g, '/'));
    }
  }
  await walk(OUT, '');
  console.log('www/ を作成しました（' + list.length + ' ファイル）');
  list.forEach(f => console.log('  ' + f));
}

main().catch(e => { console.error(e); process.exit(1); });
