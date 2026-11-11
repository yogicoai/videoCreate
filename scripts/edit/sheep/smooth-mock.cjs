// 저장소 맨 위에서 실행한다. 파란 제품을 찾는 범위(y 880~1460, x 450~2000)와 색 조건은 양 목업에 맞춰져 있다.
// 목업의 맥스 주름 펴기(무료): 파란 영역 안에서만 정규화 흐림(파란 픽셀끼리만 섞음)으로 잔주름을 지우고, 가장자리는 부드럽게 섞는다.
// 사용: node smooth-mock.cjs <입력.png> <출력.png> [흐림 sigma=22]
const sharp = require('sharp');
const [inp, out, sArg] = process.argv.slice(2);
const SIG = Number(sArg || 22);
(async () => {
  const { data, info } = await sharp(inp).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const m = Buffer.alloc(N);
  for (let y = 880; y < 1460; y++) for (let x = 450; x < 2000; x++) {
    const i = y * W + x, r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    if (b > 100 && b > r + 45 && b > g + 5) m[i] = 255;
  }
  const g1 = (buf, ch, s) => sharp(buf, { raw: { width: W, height: H, channels: ch } }).blur(s).raw().toBuffer();
  // 구멍 메우기(닫기) 후 안쪽으로 줄이기(침식)
  const closed = await g1(m, 1, 4); for (let i = 0; i < N; i++) closed[i] = closed[i] > 60 ? 255 : 0;
  const er = await g1(closed, 1, 5); for (let i = 0; i < N; i++) er[i] = er[i] > 250 ? 255 : 0;
  // 정규화 흐림: blur(img*m)/blur(m)
  const im = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) { const k = closed[i] / 255; im[i * 3] = data[i * 3] * k; im[i * 3 + 1] = data[i * 3 + 1] * k; im[i * 3 + 2] = data[i * 3 + 2] * k; }
  const A = await g1(im, 3, SIG), B = await g1(closed, 1, SIG);
  const w = await g1(er, 1, 3);
  const o = Buffer.from(data);
  for (let i = 0; i < N; i++) {
    const wt = w[i] / 255; if (wt <= 0 || B[i] < 8) continue;
    for (let c = 0; c < 3; c++) { const s = Math.min(255, A[i * 3 + c] * 255 / B[i]); o[i * 3 + c] = Math.round(data[i * 3 + c] * (1 - wt) + s * wt); }
  }
  await sharp(o, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
  console.log('주름 펴기', out);
})();
