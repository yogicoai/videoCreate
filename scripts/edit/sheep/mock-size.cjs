// 저장소 맨 위에서 실행한다. 좌표(맥스 왼끝·오른끝, 띠 y0~y1, 채울 풀밭 x)는 양 프로젝트 그림에 맞춰져 있다. 다른 그림은 복사해서 값만 바꾼다.
// 배치 참고용 목업(무료) 2판: 매끈한 v4의 맥스를 가로로 줄여 목표 길이로 만들고, 빈 자리는 v6b 오른쪽 풀밭(배경이 v4와 같음)으로 채운다.
// 영상에 쓰지 않는다. 사용: node mock-size2.cjs <목표 길이(가로 1000 기준)> <출력.png>
const sharp = require('sharp');
const F = 'data/projects/p_1bcbca7edc18678a/files/';
const SRC = F + 'r_j_cf156d850b18f377.png';   // v4
const FILL = F + 'r_j_ae5e6fc76608c0fe.png';  // v6b (오른쪽 풀밭)
const [Larg, out] = process.argv.slice(2);
(async () => {
  const meta = await sharp(SRC).metadata();
  const W = meta.width, S = W / 1000;
  const left = Math.round(227 * S), right = Math.round(903 * S);
  const keep = 900, segEnd = 2540, y0 = 958, y1 = 1430, bandH = y1 - y0;
  const R = left + Math.round(Number(Larg) * S);
  const k = (R - keep) / (right - keep);
  const segW = Math.round((segEnd - keep) * k);
  const seg = await sharp(SRC).extract({ left: keep, top: y0, width: segEnd - keep, height: bandH }).resize(segW, bandH, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  const fx = 2300, srcW = W - fx;
  const grass = await sharp(FILL).extract({ left: fx, top: y0, width: srcW, height: bandH }).toBuffer();
  const grassFlip = await sharp(grass).flop().toBuffer();
  const need = W - (keep + segW);
  const tiles = [];
  for (let x = 0, i = 0; x < need; x += srcW, i++) tiles.push({ input: i % 2 ? grass : grassFlip, left: x, top: 0 });
  const fill = await sharp({ create: { width: Math.ceil(need / srcW + 1) * srcW, height: bandH, channels: 3, background: '#000' } }).composite(tiles).png().toBuffer();
  const fillCut = await sharp(fill).extract({ left: 0, top: 0, width: need, height: bandH }).toBuffer();
  await sharp(SRC).composite([{ input: seg, left: keep, top: y0 }, { input: fillCut, left: keep + segW, top: y0 }]).png().toFile(out);
  console.log('목표 길이', Larg, '→ 오른끝', (R / S).toFixed(0), '(1000 기준), 줄임 배율', k.toFixed(3));
})();
