/* tests/contrast.js — 配色のコントラスト比を検証する
   webデザインナレッジ「文字と背景のコントラスト比 4.5:1 以上（大きい文字は3:1）」に対応。
   実行: node tests/contrast.js */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

/** :root { --x:#hex } を読む（最初のブロック＝ライトテーマ） */
function readVars(block) {
  const out = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block))) out['--' + m[1]] = m[2].trim();
  return out;
}
const lightBlock = css.slice(css.indexOf(':root{'), css.indexOf('@media (prefers-color-scheme: dark)'));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkBlock = css.slice(darkStart, css.indexOf('}\n}', darkStart));
const light = readVars(lightBlock);
const dark = readVars(darkBlock);

function hex2rgb(h) {
  h = String(h).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lum(rgb) {
  const a = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function ratio(fg, bg) {
  const a = hex2rgb(fg), b = hex2rgb(bg);
  if (!a || !b) return null;
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

let pass = 0, fail = 0;
function check(theme, vars, fgKey, bgKey, need, label) {
  const fg = vars[fgKey], bg = vars[bgKey];
  const r = ratio(fg, bg);
  if (r === null) { console.log(`  ?    ${theme} ${label}：色が読めません (${fg} / ${bg})`); fail++; return; }
  const ok = r >= need;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${theme} ${label.padEnd(30)} ${r.toFixed(2)}:1 （必要 ${need}:1）`);
}

/** 白文字を載せるボタン等 */
function checkOnColor(theme, vars, bgKey, fgHex, need, label) {
  const r = ratio(fgHex, vars[bgKey]);
  const ok = r >= need;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${theme} ${label.padEnd(30)} ${r.toFixed(2)}:1 （必要 ${need}:1）`);
}

[['ライト', light], ['ダーク', dark]].forEach(([theme, v]) => {
  const btnText = v['--on-solid'];
  console.log(`\n=== ${theme}テーマ ===`);
  check(theme, v, '--text', '--bg', 4.5, '本文 × 背景');
  check(theme, v, '--text', '--panel', 4.5, '本文 × カード');
  check(theme, v, '--text', '--panel-2', 4.5, '本文 × 薄いカード');
  check(theme, v, '--muted', '--panel', 4.5, '補助文字 × カード');
  check(theme, v, '--muted', '--panel-2', 4.5, '補助文字 × 薄いカード');
  check(theme, v, '--muted', '--bg', 4.5, '補助文字 × 背景');
  check(theme, v, '--accent-ink', '--accent-soft', 4.5, 'アクセント文字 × 淡色地');
  check(theme, v, '--ok', '--ok-soft', 4.5, '成功 × 淡色地');
  check(theme, v, '--warn', '--warn-soft', 4.5, '注意 × 淡色地');
  check(theme, v, '--ng', '--ng-soft', 4.5, 'エラー × 淡色地');
  checkOnColor(theme, v, '--accent', btnText, 4.5, '濃色上の文字 × アクセント');
  checkOnColor(theme, v, '--ok', btnText, 4.5, '濃色上の文字 × 成功色');
  checkOnColor(theme, v, '--ng', btnText, 4.5, '濃色上の文字 × エラー色');
});

console.log('\n============================');
console.log(`  成功 ${pass} / 失敗 ${fail}`);
console.log('============================');
process.exit(fail ? 1 : 0);
