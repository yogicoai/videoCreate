// prod/ 폴더(제품 앞모습 사진)가 있는 곳에서 실행한다. 태그 상자 좌표는 스퀴지보 블루·도그·팍스·유니콘 사진(카페24 views front) 기준이다.
// 스퀴지보 제품 사진의 위쪽 흰 고리 태그 지우기(무료). 상자 안의 무채색·청록 글씨 픽셀만 바꾼다.
// 몸통 윗선(bodyTop)보다 위는 흰 바탕으로, 아래(겹친 밑동)는 같은 줄의 상자 바깥 좌우 색을 이어 메운다.
const sharp = require('sharp');
const DIR = process.argv[2] || 'prod';
const jobs = [
  ['472bb906', [124, 80, 200, 172], 160], // 블루
  ['743c2f25', [136, 66, 220, 178], 171],  // 도그
  ['dd3b3acc', [136, 44, 230, 156], 146],  // 팍스
  ['b097fc3c', [20, 76, 150, 170], 156],   // 유니콘
];
(async () => {
  for (const [id, [x0, y0, x1, y1], top] of jobs) {
    const { data, info } = await sharp(`${DIR}/${id}.jpg`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, C = 3;
    const at = (x, y) => [data[(y * W + x) * C], data[(y * W + x) * C + 1], data[(y * W + x) * C + 2]];
    const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
    const teal = ([r, g, b]) => g > 120 && b > 120 && r < 150 && Math.abs(g - b) < 60;
    const tagLike = (p) => sat(p) < 0.22 || teal(p);
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      const L = at(Math.max(0, x0 - 3), y), R = at(Math.min(W - 1, x1 + 3), y);
      for (let x = x0; x <= x1; x++) {
        const p = at(x, y);
        const above = y < top - 1;
        if (above ? (sat(p) > 0.45 && !teal(p)) : !tagLike(p)) continue;
        let q;
        if (above) q = [252, 252, 252];
        else { const t = (x - x0) / Math.max(1, x1 - x0); q = [0, 1, 2].map((c) => Math.round(L[c] * (1 - t) + R[c] * t)); }
        const i = (y * W + x) * C; data[i] = q[0]; data[i + 1] = q[1]; data[i + 2] = q[2]; n++;
      }
    }
    await sharp(data, { raw: { width: W, height: info.height, channels: 3 } }).jpeg({ quality: 95 }).toFile(`${DIR}/${id}_notag.jpg`);
    console.log(id, '바꾼 픽셀', n);
  }
  const ids = jobs.map((j) => j[0]); const tiles = [];
  for (let i = 0; i < ids.length; i++) {
    tiles.push({ input: await sharp(`${DIR}/${ids[i]}.jpg`).resize(240, 436, { fit: 'contain', background: '#fff' }).toBuffer(), left: i * 490, top: 0 });
    tiles.push({ input: await sharp(`${DIR}/${ids[i]}_notag.jpg`).resize(240, 436, { fit: 'contain', background: '#fff' }).toBuffer(), left: i * 490 + 245, top: 0 });
  }
  await sharp({ create: { width: 1960, height: 436, channels: 3, background: '#ddd' } }).composite(tiles).jpeg({ quality: 88 }).toFile('detag-check.jpg');
})();
