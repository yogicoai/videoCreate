// 이음새마다 앞 장면 마지막 프레임과 뒷 장면 첫 프레임을 견준다: 평균 색(RGB), 크기·위치 어긋남, 앞뒤 움직임.
const fs = require('fs');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const F = 'data/projects/p_6eb3a2ed4b20b8a0/files/';
const E = (process.env.EDIT_WORK || 'tests/.tmp/edit') + '/';
const T = E + 'seamfr/';
fs.mkdirSync(T, { recursive: true });
const scenes = JSON.parse(fs.readFileSync(E + 'scenes.json', 'utf8'));
const W = 480, H = 854;
const grab = (file, n, out) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', F + file, '-vf', `select='eq(n\\,${n})'`, '-frames:v', '1', out]);
async function rgbMean(file) { const s = await sharp(file).stats(); return s.channels.slice(0, 3).map((c) => c.mean); }
async function gray(file, w, h) { return (await sharp(file).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer()); }
function sample(img, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = x - x0, fy = y - y0;
  return img[y0 * w + x0] * (1 - fx) * (1 - fy) + img[y0 * w + x0 + 1] * fx * (1 - fy) + img[(y0 + 1) * w + x0] * (1 - fx) * fy + img[(y0 + 1) * w + x0 + 1] * fx * fy;
}
// big(넓은 쪽)의 어느 영역을 키우면 small(당겨진 쪽)과 같아지는지 찾는다. 밝기 차이는 평균을 빼서 무시한다
async function matchZoom(bigFile, smallFile) {
  const big = await gray(bigFile, W, H);
  const tw = 96, th = 171;
  const tpl = await gray(smallFile, tw, th);
  const tm = tpl.reduce((a, b) => a + b, 0) / tpl.length;
  let best = { e: Infinity };
  for (let s = 1.0; s <= 1.16; s += 0.005) {
    const cw = W / s, ch = H / s;
    for (let x0 = 0; x0 <= W - cw + 0.01; x0 += 1) for (let y0 = 0; y0 <= H - ch + 0.01; y0 += 1) {
      let sum = 0, n = 0, vals = [];
      for (let j = 1; j < th; j += 3) for (let i = 1; i < tw; i += 3) vals.push([sample(big, W, H, x0 + (i + 0.5) * cw / tw, y0 + (j + 0.5) * ch / th), tpl[j * tw + i]]);
      const bm = vals.reduce((a, v) => a + v[0], 0) / vals.length;
      for (const [b, t] of vals) { sum += Math.abs(b - bm - (t - tm)); n++; }
      const e = sum / n;
      if (e < best.e) best = { e: +e.toFixed(2), s: +s.toFixed(3), x0: +x0.toFixed(1), y0: +y0.toFixed(1) };
    }
  }
  return best;
}
(async () => {
  const report = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const a = scenes[i], b = scenes[i + 1];
    const fa = T + `${a.name}_last.png`, fb = T + `${b.name}_first.png`;
    grab(a.file, a.to, fa);
    grab(b.file, b.from, fb);
    const ma = await rgbMean(fa), mb = await rgbMean(fb);
    const fwd = await matchZoom(fa, fb); // 뒷 장면이 더 당겨져 있으면 여기서 s>1
    const back = await matchZoom(fb, fa); // 앞 장면이 더 당겨져 있으면 여기서 s>1
    report.push({ seam: `${a.name}->${b.name}`, rgbA: ma.map((v) => +v.toFixed(1)), rgbB: mb.map((v) => +v.toFixed(1)), gain: ma.map((v, k) => +(v / mb[k]).toFixed(3)), fwd, back });
    console.log(JSON.stringify(report[report.length - 1]));
  }
  fs.writeFileSync(E + 'seams.json', JSON.stringify(report, null, 1));
})();
