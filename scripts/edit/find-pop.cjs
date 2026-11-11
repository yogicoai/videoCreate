// 편집본에서 이음새 앞뒤 프레임을 견줘, 갑자기 생긴 물건(뚜껑)이 있는 자리를 찾는다(1080×1920 기준).
// 사용: node find-pop.cjs <mp4> <앞 프레임> <뒤 프레임>
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const [file, a, b] = process.argv.slice(2);
const E = (process.env.EDIT_WORK || 'tests/.tmp/edit') + '/';
const grab = (n, out) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', `select='eq(n\\,${n})'`, '-frames:v', '1', out]);
(async () => {
  const fa = E + `pop_${a}.png`, fb = E + `pop_${b}.png`;
  grab(a, fa); grab(b, fb);
  const W = 270, H = 480;
  const A = await sharp(fa).resize(W, H).raw().toBuffer();
  const B = await sharp(fb).resize(W, H).raw().toBuffer();
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = Math.abs(A[i * 3] - B[i * 3]) + Math.abs(A[i * 3 + 1] - B[i * 3 + 1]) + Math.abs(A[i * 3 + 2] - B[i * 3 + 2]);
  // 차이가 큰 칸(상위 3%)의 무게중심과 범위
  const sorted = Array.from(d).sort((x, y) => y - x);
  const th = Math.max(60, sorted[Math.floor(W * H * 0.03)]);
  let sx = 0, sy = 0, n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[y * W + x] >= th) { sx += x; sy += y; n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = 1080 / W;
  console.log(JSON.stringify({ a, b, th: Math.round(th), n, center: [Math.round(sx / n * k), Math.round(sy / n * k)], box: [Math.round(x0 * k), Math.round(y0 * k), Math.round(x1 * k), Math.round(y1 * k)] }));
})();
