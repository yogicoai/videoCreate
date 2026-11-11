// 이음새에서 뚜껑이 나타나는 자리에 「뿅」 반짝임(둥근 빛 + 네 갈래 별)을 그린다. 1080×1920 투명 PNG 묶음. 크레딧 0.
// 사용: node render-burst.cjs <출력 폴더> <프레임 수> <절정 프레임> <cx,cy,R>[;<cx,cy,R>...] [씨앗]
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const [outDir, nArg, peakArg, spotsArg, seedArg] = process.argv.slice(2);
const N = Number(nArg), PEAK = Number(peakArg);
const spots = spotsArg.split(';').map((s) => s.split(',').map(Number));
let seed = Number(seedArg ?? 7);
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function star(x, y, s, rot, op) {
  const c = s * 0.14;
  const d = `M0,${-s} C${c},${-c} ${c},${-c} ${s},0 C${c},${c} ${c},${c} 0,${s} C${-c},${c} ${-c},${c} ${-s},0 C${-c},${-c} ${-c},${-c} 0,${-s} Z`;
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)})" opacity="${op.toFixed(3)}"><path d="${d}" fill="#fff1c2" filter="url(#soft)"/><path d="${d}" fill="#fffdf6"/></g>`;
}
// 자리마다 별 6개: 나타나는 시각, 위치, 크기를 미리 정한다
const plan = spots.map(([cx, cy, R], si) => ({
  cx, cy, R,
  stars: Array.from({ length: si === 0 ? 7 : 5 }, (_, k) => {
    const a = rnd() * Math.PI * 2, r = R * (0.25 + 0.75 * Math.sqrt(rnd()));
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.8, s: R * (0.09 + 0.1 * rnd()) * (k === 0 ? 1.4 : 1), t0: PEAK - 3 + Math.floor(rnd() * 4), len: 8 + Math.floor(rnd() * 4), rot: rnd() * 40 };
  }),
}));
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  for (let f = 0; f < N; f++) {
    let body = '';
    for (const p of plan) {
      // 둥근 빛: 절정에서 가장 밝고 앞뒤로 빠르게 사라진다(빛살 무늬 없이 둥글게만)
      const g = Math.max(0, 1 - Math.abs(f - PEAK) / (f < PEAK ? 3 : 6));
      if (g > 0) body += `<circle cx="${p.cx}" cy="${p.cy}" r="${(p.R * (0.75 + 0.25 * g)).toFixed(1)}" fill="url(#glow)" opacity="${(0.55 * g).toFixed(3)}"/>`;
      for (const s of p.stars) {
        const u = (f - s.t0) / s.len;
        if (u < 0 || u > 1) continue;
        const k = Math.sin(u * Math.PI);
        body += star(s.x, s.y, s.s * k + 0.5, s.rot + 30 * u, Math.min(1, k * 1.3));
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs>
<radialGradient id="glow"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.45" stop-color="#fff6dc" stop-opacity="0.55"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="5"/></filter></defs>${body}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `f_${String(f).padStart(4, '0')}.png`));
  }
  console.log(outDir, N);
})();
