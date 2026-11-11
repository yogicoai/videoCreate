// 간판 조각으로 매 프레임 간판 판의 가운데(cx,cy)와 배율(s)을 1/4픽셀까지 잰다. 기준 프레임에서는 판 가운데 (103.75,224.5), 배율 1.
// 사용: node track-sign-fine.cjs <영상> <기준 프레임> <끝 프레임> <출력 json> [찾는 폭 px] [배율 폭]
const fs = require('fs');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const [video, refArg, toArg, out, winArg, sWinArg] = process.argv.slice(2);
const REF = Number(refArg), TO = Number(toArg), DIR = TO > REF ? 1 : -1;
const WIN = Number(winArg ?? 6), SWIN = Number(sWinArg ?? 0.03);
const T = (process.env.EDIT_WORK || 'tests/.tmp/edit') + '/one/fine/';
fs.mkdirSync(T, { recursive: true });
const W = 480, H = 854;
const PC = { x: 103.75, y: 224.5 };
const BOX = { x0: 40, y0: 172, x1: 170, y1: 268 };
// 한 번에 프레임을 뽑아 둔다
const first = Math.min(REF, TO), last = Math.max(REF, TO);
if (!fs.existsSync(T + `f_${String(last).padStart(4, '0')}.png`))
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', `select='between(n\\,${first}\\,${last})'`, '-fps_mode', 'passthrough', '-start_number', String(first), T + 'f_%04d.png']);
const file = (n) => T + `f_${String(n).padStart(4, '0')}.png`;
async function rgb(f) { return sharp(f).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer(); }
function sample(img, x, y, c) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return null;
  const fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 3 + c;
  return img[i] * (1 - fx) * (1 - fy) + img[i + 3] * fx * (1 - fy) + img[i + W * 3] * (1 - fx) * fy + img[i + W * 3 + 3] * fx * fy;
}
(async () => {
  const ref = await rgb(file(REF));
  const tpl = [];
  for (let v = BOX.y0; v < BOX.y1; v += 1) for (let u = BOX.x0; u < BOX.x1; u += 1) tpl.push([u - PC.x, v - PC.y, ref[(v * W + u) * 3], ref[(v * W + u) * 3 + 1], ref[(v * W + u) * 3 + 2]]);
  const sub = tpl.filter((_, i) => i % 3 === 0);
  const score = (img, cx, cy, s, set) => {
    let sum = 0, n = 0;
    for (const [du, dv, r, g, b] of set) {
      const x = cx + du * s, y = cy + dv * s;
      const R = sample(img, x, y, 0);
      if (R === null) continue;
      sum += Math.abs(R - r) + Math.abs(sample(img, x, y, 1) - g) + Math.abs(sample(img, x, y, 2) - b);
      n++;
    }
    return n < set.length * 0.35 ? Infinity : sum / n / 3;
  };
  let prev = { cx: PC.x, cy: PC.y, s: 1 }, vel = { cx: 0, cy: 0, s: 0 };
  const res = [{ n: REF, cx: PC.x, cy: PC.y, s: 1, e: 0 }];
  for (let n = REF + DIR; DIR > 0 ? n <= TO : n >= TO; n += DIR) {
    const img = await rgb(file(n));
    const guess = { cx: prev.cx + vel.cx, cy: prev.cy + vel.cy, s: prev.s + vel.s };
    let best = { e: Infinity };
    for (let s = guess.s - SWIN; s <= guess.s + SWIN; s += 0.0025)
      for (let cx = guess.cx - WIN; cx <= guess.cx + WIN; cx += 1)
        for (let cy = guess.cy - WIN; cy <= guess.cy + WIN; cy += 1) {
          const e = score(img, cx, cy, s, sub);
          if (e < best.e) best = { e, cx, cy, s };
        }
    // 1/4픽셀로 다듬기
    let fine = best;
    for (let s = best.s - 0.004; s <= best.s + 0.004; s += 0.001)
      for (let cx = best.cx - 1; cx <= best.cx + 1; cx += 0.25)
        for (let cy = best.cy - 1; cy <= best.cy + 1; cy += 0.25) {
          const e = score(img, cx, cy, s, tpl);
          if (e < fine.e || fine === best) fine = { e, cx, cy, s };
        }
    if (!isFinite(fine.e)) { console.log('stop at', n); break; }
    vel = { cx: fine.cx - prev.cx, cy: fine.cy - prev.cy, s: fine.s - prev.s };
    prev = fine;
    res.push({ n, cx: +fine.cx.toFixed(2), cy: +fine.cy.toFixed(2), s: +fine.s.toFixed(4), e: +fine.e.toFixed(2) });
    if ((n - REF) % 10 === 0) console.log(JSON.stringify(res[res.length - 1]));
  }
  res.sort((a, b) => a.n - b.n);
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log('frames', res.length);
})();
