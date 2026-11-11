// 첫 프레임 기준으로 n번째 프레임이 얼마나 당겨지고 옮겨졌는지(배율 s, 첫 프레임에서의 왼쪽 위 x0,y0)를 잰다. 480×854 기준.
// 사용: node track-cam.cjs <영상> <프레임 목록 쉼표> <출력 json>
const fs = require('fs');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const [video, listArg, out] = process.argv.slice(2);
const T = (process.env.EDIT_WORK || 'tests/.tmp/edit') + '/one/track/';
fs.mkdirSync(T, { recursive: true });
const W = 480, H = 854;
const grab = (n) => { const f = T + `t${n}.png`; if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', `select='eq(n\\,${n})'`, '-frames:v', '1', f]); return f; };
async function gray(file, w, h) { return sharp(file).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer(); }
function sample(img, x, y) {
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(x))), y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
  const fx = x - x0, fy = y - y0;
  return img[y0 * W + x0] * (1 - fx) * (1 - fy) + img[y0 * W + x0 + 1] * fx * (1 - fy) + img[(y0 + 1) * W + x0] * (1 - fx) * fy + img[(y0 + 1) * W + x0 + 1] * fx * fy;
}
function err(big, tpl, tw, th, s, x0, y0, step) {
  const cw = W / s, ch = H / s;
  const vals = [];
  for (let j = 1; j < th; j += step) for (let i = 1; i < tw; i += step) vals.push([sample(big, x0 + (i + 0.5) * cw / tw, y0 + (j + 0.5) * ch / th), tpl[j * tw + i]]);
  const bm = vals.reduce((a, v) => a + v[0], 0) / vals.length, tm = vals.reduce((a, v) => a + v[1], 0) / vals.length;
  return vals.reduce((a, [b, t]) => a + Math.abs(b - bm - (t - tm)), 0) / vals.length;
}
(async () => {
  const big = await gray(grab(0), W, H);
  const tw = 60, th = 107;
  const res = [];
  for (const n of listArg.split(',').map(Number)) {
    const tpl = await gray(grab(n), tw, th);
    let best = { e: Infinity };
    for (let s = 1.0; s <= 1.3; s += 0.01) {
      const cw = W / s, ch = H / s;
      for (let x0 = 0; x0 <= W - cw + 0.01; x0 += 2) for (let y0 = 0; y0 <= H - ch + 0.01; y0 += 2) {
        const e = err(big, tpl, tw, th, s, x0, y0, 2);
        if (e < best.e) best = { e, s, x0, y0 };
      }
    }
    let fine = best;
    for (let s = best.s - 0.012; s <= best.s + 0.012; s += 0.002) {
      const cw = W / s, ch = H / s;
      for (let x0 = best.x0 - 3; x0 <= best.x0 + 3; x0 += 0.5) for (let y0 = best.y0 - 3; y0 <= best.y0 + 3; y0 += 0.5) {
        if (x0 < 0 || y0 < 0 || x0 + cw > W || y0 + ch > H) continue;
        const e = err(big, tpl, tw, th, s, x0, y0, 1);
        if (e < fine.e) fine = { e, s, x0, y0 };
      }
    }
    const r = { n, s: +fine.s.toFixed(4), x0: +fine.x0.toFixed(2), y0: +fine.y0.toFixed(2), e: +fine.e.toFixed(2) };
    res.push(r);
    console.log(JSON.stringify(r));
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
})();
