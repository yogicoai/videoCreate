// 16:9 장면 그림을 세로(9:16) 배치 목업으로 바꾼다(무료). 생성 모델에 「배치 참고용」으로 넣을 그림이다.
// 장면 띠(양과 맥스가 든 가로 구간)는 그대로 두고, 위는 하늘, 아래는 풀밭을 원본에서 떼어 와 채운다.
// 실행: 프로젝트 폴더에서 node ../../../scripts/edit/sheep/mock-916.cjs <16:9 그림> <출력 png>
//   환경 변수로 조정: X0, X1(띠의 가로 범위, 원본 폭 비율), SUBJ_SRC(원본에서 양·맥스 바닥 높이 비율),
//   SUBJ_DST(세로 화면에서 그 바닥이 올 높이 비율)
const path = require('path');
const sharp = require(path.join(__dirname, '../../../node_modules/sharp'));

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error('사용: node mock-916.cjs <16:9 그림> <출력 png>');
  process.exit(1);
}
const num = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);
const X0 = num('X0', 0.03), X1 = num('X1', 0.81);
const SUBJ_SRC = num('SUBJ_SRC', 0.88), SUBJ_DST = num('SUBJ_DST', 0.72);
const W = 1536, H = 2752, F = 90; // 2K 세로, 이음새를 섞는 폭

(async () => {
  const { width: w, height: h } = await sharp(src).metadata();
  const cx = Math.round(X0 * w), cw = Math.round((X1 - X0) * w);
  const bandH = Math.round((h * W) / cw);
  const y0 = Math.round(SUBJ_DST * H - SUBJ_SRC * bandH);
  const yb = y0 + bandH;
  if (y0 < F || yb > H - F) throw new Error(`띠가 화면 밖으로 나가요 (위 ${y0}, 아래 ${yb})`);

  // 장면 띠: 위아래 끝을 F만큼 부드럽게 투명하게 한다
  const band = await sharp(src).extract({ left: cx, top: 0, width: cw, height: h }).resize(W, bandH).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < bandH; y++) {
    const a = Math.min(1, y / F, (bandH - 1 - y) / F);
    for (let x = 0; x < W; x++) band[(y * W + x) * 4 + 3] = Math.round(255 * Math.max(0, a));
  }

  // 하늘: 원본 위쪽 하늘에서 가운데 조각을 거의 같은 비율로 키운다
  const skyH = y0 + F;
  const skySrcH = Math.round(h * 0.28);
  const skySrcW = Math.min(w, Math.round((skySrcH * W) / skyH));
  const sky = await sharp(src)
    .extract({ left: Math.round((w - skySrcW) / 2), top: 0, width: skySrcW, height: skySrcH })
    .resize(W, skyH, { fit: 'fill' }).blur(1.2).toBuffer();

  // 풀밭: 원본 오른쪽 아래(제품이 없는 곳)의 풀을 키운다
  const grassH = H - yb + F;
  const gx = Math.round(w * 0.80), gy = Math.round(h * 0.70);
  const grass = await sharp(src)
    .extract({ left: gx, top: gy, width: w - gx, height: h - gy })
    .resize(W, grassH, { fit: 'fill' }).blur(1.2).toBuffer();

  await sharp({ create: { width: W, height: H, channels: 3, background: '#9fb8d0' } })
    .composite([
      { input: sky, top: 0, left: 0 },
      { input: grass, top: yb - F, left: 0 },
      { input: band, raw: { width: W, height: bandH, channels: 4 }, top: y0, left: 0 },
    ])
    .png().toFile(out);
  console.log(`${out}  ${W}x${H}  장면 띠 ${y0}~${yb}px (원본 가로 ${Math.round(X0 * 100)}~${Math.round(X1 * 100)}%)`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
