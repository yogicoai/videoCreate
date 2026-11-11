// 매끄럽게 다듬은 간판 위치(cx,cy,s: 480×854 기준)를 따라 로고를 2160×3840 기준으로 그린다(나중에 반으로 줄여 얹음).
// fx=1 이면 빛줄기(0.45·2.1·3.75초)와 별 반짝임을 넣는다.
// 사용: node render-logo-smooth.cjs <추적 json> <첫 프레임> <끝 프레임> <영역 x,y,w,h(2160 기준)> <fx 0|1> <출력 폴더>
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const LOGO = 'data/library/kits/yogibo-endcard/yogibo-logo.png';
const [trackFile, fromArg, toArg, regionArg, fxArg, outDir] = process.argv.slice(2);
const FROM = +fromArg, TO = +toArg, [RX, RY, RW, RH] = regionArg.split(',').map(Number), FX = fxArg === '1';
const K = 4.5, SKEW = -16.2, PANEL_W = 83, FPS = 24;
const track = new Map(JSON.parse(fs.readFileSync(trackFile, 'utf8')).map((r) => [r.n, r]));
function star(x, y, s, rot, op) {
  const c = s * 0.14;
  const d = `M0,${-s} C${c},${-c} ${c},${-c} ${s},0 C${c},${c} ${c},${c} 0,${s} C${-c},${c} ${-c},${c} ${-s},0 C${-c},${-c} ${-c},${-c} 0,${-s} Z`;
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)})" opacity="${op.toFixed(3)}"><path d="${d}" fill="#fff4cc" filter="url(#soft)"/><path d="${d}" fill="#fffdf4"/></g>`;
}
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const meta = await sharp(LOGO).metadata();
  const logoB64 = (await sharp(LOGO).png().toBuffer()).toString('base64');
  const { data, info } = await sharp(LOGO).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
  const whiteB64 = (await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()).toString('base64');
  const twinkles = [[-0.55, -0.62, 0.15], [0.56, -0.58, 0.7], [0.62, 0.55, 1.25], [-0.6, 0.52, 1.95], [0.1, -0.78, 2.6], [0.6, -0.6, 3.25], [-0.5, -0.6, 3.9], [0.55, 0.5, 4.5]];
  const sweeps = [0.45, 2.1, 3.75];
  for (let n = FROM; n <= TO; n++) {
    const p = track.get(n);
    const t = (n - FROM) / FPS;
    const lw = PANEL_W * 0.78 * K, lh = lw * meta.height / meta.width; // 로고 자체 크기(배율 1 기준), 배율은 scale로 준다
    const cx = p.cx * K - RX, cy = p.cy * K - RY;
    let sweep = '', stars = '';
    if (FX) {
      for (const s0 of sweeps) {
        const u = (t - s0) / 0.55;
        if (u < 0 || u > 1) continue;
        const x = -lw * 0.9 + u * lw * 1.8;
        sweep += `<rect x="${(x - lw * 0.18).toFixed(1)}" y="${(-lh).toFixed(1)}" width="${(lw * 0.36).toFixed(1)}" height="${(lh * 2).toFixed(1)}" fill="url(#band)" transform="rotate(18 ${x.toFixed(1)} 0)"/>`;
      }
      for (const [ux, uy, t0] of twinkles) {
        const u = (t - t0) / 0.45;
        if (u < 0 || u > 1) continue;
        const k = Math.sin(u * Math.PI);
        stars += star(ux * lw * 1.05, uy * lh * 1.7, lw * 0.13 * k + 0.5, 25 * u, k);
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${RW}" height="${RH}"><defs>
<linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.97"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="m" maskUnits="userSpaceOnUse" x="${(-lw).toFixed(1)}" y="${(-lh).toFixed(1)}" width="${(lw * 2).toFixed(1)}" height="${(lh * 2).toFixed(1)}"><image x="${(-lw / 2).toFixed(1)}" y="${(-lh / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" xlink:href="data:image/png;base64,${whiteB64}" href="data:image/png;base64,${whiteB64}"/></mask>
<filter id="soft" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="${(lw * 0.02).toFixed(2)}"/></filter>
<filter id="ink" x="-0.1" y="-0.1" width="1.2" height="1.2"><feGaussianBlur stdDeviation="${(K * 0.12).toFixed(2)}"/></filter></defs>
<g transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) skewY(${SKEW}) scale(${p.s.toFixed(5)})">
<image x="${(-lw / 2).toFixed(1)}" y="${(-lh / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" xlink:href="data:image/png;base64,${logoB64}" href="data:image/png;base64,${logoB64}" filter="url(#ink)" opacity="0.96"/>
<g mask="url(#m)">${sweep}</g>${stars}</g></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `f_${String(n - FROM).padStart(4, '0')}.png`));
  }
  console.log(outDir, TO - FROM + 1);
})();
