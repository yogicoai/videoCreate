// 장면 1 마지막 화면에서, 장면 2 첫 화면과 같은 부분(확대 영역)을 찾는다. 결과: 480×854 기준 x, y, 배율.
// 사용: node match-zoom.cjs <넓은 화면 png> <당겨진 화면 png>
const sharp = require('sharp');
const [wideFile, zoomFile] = process.argv.slice(2);
const W = 480, H = 854;
async function gray(file, w, h) {
  const { data } = await sharp(file).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data;
}
function sample(img, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = x - x0, fy = y - y0;
  const a = img[y0 * w + x0], b = img[y0 * w + x0 + 1], c = img[(y0 + 1) * w + x0], d = img[(y0 + 1) * w + x0 + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}
function score(wide, tpl, tw, th, s, x0, y0, step) {
  // tpl 은 당겨진 화면을 tw×th 로 줄인 것. 넓은 화면의 (x0,y0)부터 W/s×H/s 영역을 같은 격자로 읽어 견준다
  const cw = W / s, ch = H / s;
  let sum = 0, n = 0;
  for (let j = 0; j < th; j += step) for (let i = 0; i < tw; i += step) {
    const x = x0 + (i + 0.5) * cw / tw, y = y0 + (j + 0.5) * ch / th;
    sum += Math.abs(sample(wide, W, H, x, y) - tpl[j * tw + i]);
    n++;
  }
  return sum / n;
}
(async () => {
  const wide = await gray(wideFile, W, H);
  const tw = 60, th = 107;
  const tpl = await gray(zoomFile, tw, th);
  let best = { e: Infinity };
  for (let s = 1.3; s <= 2.6; s += 0.04) {
    const cw = W / s, ch = H / s;
    for (let x0 = 0; x0 <= W - cw; x0 += 4) for (let y0 = 0; y0 <= H - ch; y0 += 4) {
      const e = score(wide, tpl, tw, th, s, x0, y0, 2);
      if (e < best.e) best = { e, s, x0, y0 };
    }
  }
  // 둘레를 더 촘촘히
  let fine = best;
  for (let s = best.s - 0.05; s <= best.s + 0.05; s += 0.005) {
    const cw = W / s, ch = H / s;
    for (let x0 = best.x0 - 6; x0 <= best.x0 + 6; x0 += 0.5) for (let y0 = best.y0 - 6; y0 <= best.y0 + 6; y0 += 0.5) {
      if (x0 < 0 || y0 < 0 || x0 + cw > W || y0 + ch > H) continue;
      const e = score(wide, tpl, tw, th, s, x0, y0, 1);
      if (e < fine.e) fine = { e, s, x0, y0 };
    }
  }
  console.log(JSON.stringify({ coarse: best, fine: { ...fine, w: W / fine.s, h: H / fine.s } }));
})();
