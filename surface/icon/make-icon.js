// make-icon.js — generates the app icon: three rings of 3, 4 and 5 evenly spaced beats (a
// polyrhythm) meeting at the top, the shared downbeat, on the Nord palette.
// Writes icon.svg, icon.png (1024) and icon.icns next to this file.
// Needs macOS (Quick Look renders the SVG, iconutil builds the .icns) and ImageMagick (`magick`).
// Run: node surface/icon/make-icon.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const SIZE = 1024;
const C = SIZE / 2;
const nord = {
  bg: '#2E3440', panel: '#3B4252', ring: '#434C5E',
  frost: ['#8FBCBB', '#88C0D0', '#81A1C1'], downbeat: '#EBCB8B', light: '#ECEFF4',
};

// Rings, outer to inner: beats per cycle, radius, dot radius, colour.
const rings = [
  { beats: 5, r: 300, dot: 34, color: nord.frost[2] },
  { beats: 4, r: 210, dot: 38, color: nord.frost[1] },
  { beats: 3, r: 120, dot: 42, color: nord.frost[0] },
];

const at = (r, i, n) => {
  const a = (i / n) * 2 * Math.PI - Math.PI / 2;  // beat 0 at the top, clockwise
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

const parts = [];
// macOS icon grid: 824 px rounded square centred on a 1024 canvas
parts.push(`<rect x="100" y="100" width="824" height="824" rx="185" fill="${nord.bg}"/>`);
parts.push(`<rect x="100" y="100" width="824" height="824" rx="185" fill="none" stroke="${nord.panel}" stroke-width="6"/>`);
for (const { r } of rings) {
  parts.push(`<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${nord.ring}" stroke-width="10"/>`);
}
// playhead from the centre to the downbeat
parts.push(`<line x1="${C}" y1="${C}" x2="${C}" y2="${C - rings[0].r}" stroke="${nord.light}" stroke-opacity="0.35" stroke-width="10" stroke-linecap="round"/>`);
for (const { beats, r, dot, color } of rings) {
  for (let i = 1; i < beats; i++) {
    const [x, y] = at(r, i, beats);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dot}" fill="${color}"/>`);
  }
  const [x, y] = at(r, 0, beats);
  parts.push(`<circle cx="${x}" cy="${y}" r="${dot}" fill="${nord.downbeat}"/>`);
}
parts.push(`<circle cx="${C}" cy="${C}" r="16" fill="${nord.light}" fill-opacity="0.6"/>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">\n  ${parts.join('\n  ')}\n</svg>\n`;
fs.writeFileSync(path.join(DIR, 'icon.svg'), svg);

// Rasterize with Quick Look (WebKit; ImageMagick's own SVG renderer drops stroked circles). It
// paints the corners white, so cut them back to transparent with the rounded-square mask.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-'));
execFileSync('qlmanage', ['-t', '-s', String(SIZE), '-o', tmp, path.join(DIR, 'icon.svg')], { stdio: 'ignore' });
const png = path.join(DIR, 'icon.png');
execFileSync('magick', [path.join(tmp, 'icon.svg.png'),
  '(', '-size', `${SIZE}x${SIZE}`, 'xc:none', '-fill', 'white', '-draw', 'roundrectangle 97,97 926,926 188,188', ')',
  '-compose', 'CopyOpacity', '-composite', png]);
fs.rmSync(tmp, { recursive: true });

// The iconset sizes macOS wants, then .icns.
const set = path.join(DIR, 'icon.iconset');
fs.rmSync(set, { recursive: true, force: true });
fs.mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  execFileSync('magick', [png, '-resize', `${s}x${s}`, path.join(set, `icon_${s}x${s}.png`)]);
  execFileSync('magick', [png, '-resize', `${s * 2}x${s * 2}`, path.join(set, `icon_${s}x${s}@2x.png`)]);
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(DIR, 'icon.icns')]);
fs.rmSync(set, { recursive: true });
console.log('wrote icon.svg, icon.png, icon.icns');
