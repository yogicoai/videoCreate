// 간판 위 로고 + 반짝임(빛줄기 한 번 지나가기, 작은 네 갈래 반짝이) 프레임을 PNG 묶음으로 그린다. 크레딧 0.
// 사용: node render-logo.cjs <start|end> <출력 폴더> <프레임 수>
// start: 장면 1(고정 화면)을 2160×3840으로 키운 위에 얹는다. end: 마지막 정지 화면(1080×1920)에 얹고 로고가 톡 튀어나온다.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const LOGO = 'data/library/kits/yogibo-endcard/yogibo-logo.png';
const [mode, outDir, framesArg] = process.argv.slice(2);
const FRAMES = Number(framesArg);
const FPS = 24;
// 480×854 기준 간판 안쪽 판: 가운데와 폭, 기울기(오른쪽이 올라감)
const PANEL = { cx: 103.75, cy: 224.5, w: 83 };
const SKEW = -16.2; // 도(degree). 판 윗변이 오른쪽으로 갈수록 올라간다
const cfg = mode === 'start'
  ? { k: 4.5, rx: 200, ry: 760, rw: 600, rh: 520, pop: false }
  : { k: 2.25, rx: 60, ry: 360, rw: 360, rh: 300, pop: !process.env.NOPOP };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
function star(x, y, s, rot, op) {
  const c = s * 0.14;
  const d = `M0,${-s} C${c},${-c} ${c},${-c} ${s},0 C${c},${c} ${c},${c} 0,${s} C${-c},${c} ${-c},${c} ${-s},0 C${-c},${-c} ${-c},${-c} 0,${-s} Z`;
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)})" opacity="${op.toFixed(3)}">` +
    `<path d="${d}" fill="#fff4cc" filter="url(#soft)"/><path d="${d}" fill="#fffdf4"/></g>`;
}
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const meta = await sharp(LOGO).metadata();
  const logoB64 = (await sharp(LOGO).png().toBuffer()).toString('base64');
  // 빛줄기를 로고 모양으로만 보이게 하는 흰 실루엣
  const { data, info } = await sharp(LOGO).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
  const whiteB64 = (await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()).toString('base64');

  const k = cfg.k;
  const cx = PANEL.cx * k - cfg.rx, cy = PANEL.cy * k - cfg.ry;
  const lw = PANEL.w * 0.78 * k, lh = lw * meta.height / meta.width;
  // 판 모서리 둘레(로고 기준 좌표)에서 반짝이가 뜨는 자리와 시각(초)
  const twinkles = mode === 'start'
    ? [[-0.55, -0.62, 0.15], [0.56, -0.58, 0.7], [0.62, 0.55, 1.25], [-0.6, 0.52, 1.95], [0.1, -0.78, 2.6], [0.6, -0.6, 3.25], [-0.5, -0.6, 3.9], [0.55, 0.5, 4.5]]
    : [[-0.55, -0.62, 0.35], [0.58, -0.58, 0.6], [0.6, 0.55, 0.9], [-0.58, 0.5, 1.15]];
  const sweeps = mode === 'start' ? [0.45, 2.1, 3.75] : [0.3];
  for (let f = 0; f < FRAMES; f++) {
    const t = f / FPS;
    // 끝 화면: 로고가 작게 시작해 톡 커졌다가 자리 잡는다(0.3초)
    let scale = 1, op = 1;
    if (cfg.pop) {
      const p = clamp(t / 0.3, 0, 1);
      scale = p < 1 ? 0.55 + 0.53 * easeOut(p) - 0.08 * Math.sin(p * Math.PI) * (p > 0.6 ? 1 : 0) : 1;
      if (p >= 1) scale = 1;
      op = clamp(t / 0.12, 0, 1);
    }
    let sweep = '';
    for (const s0 of sweeps) {
      const p = (t - s0) / 0.55;
      if (p < 0 || p > 1) continue;
      const x = -lw * 0.9 + p * lw * 1.8;
      sweep += `<rect x="${(x - lw * 0.18).toFixed(1)}" y="${(-lh).toFixed(1)}" width="${(lw * 0.36).toFixed(1)}" height="${(lh * 2).toFixed(1)}" fill="url(#band)" transform="rotate(18 ${x.toFixed(1)} 0)"/>`;
    }
    let stars = '';
    for (const [ux, uy, t0] of twinkles) {
      const p = (t - t0) / 0.45;
      if (p < 0 || p > 1) continue;
      const s = Math.sin(p * Math.PI);
      stars += star(ux * lw * 1.05, uy * lh * 1.7, lw * 0.13 * s + 0.5, 25 * p, s);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${cfg.rw}" height="${cfg.rh}">
<defs>
  <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.97"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <mask id="m" maskUnits="userSpaceOnUse" x="${(-lw).toFixed(1)}" y="${(-lh).toFixed(1)}" width="${(lw * 2).toFixed(1)}" height="${(lh * 2).toFixed(1)}">
    <image x="${(-lw / 2).toFixed(1)}" y="${(-lh / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" xlink:href="data:image/png;base64,${whiteB64}" href="data:image/png;base64,${whiteB64}"/>
  </mask>
  <filter id="soft" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="${(lw * 0.02).toFixed(2)}"/></filter>
  <filter id="ink" x="-0.1" y="-0.1" width="1.2" height="1.2"><feGaussianBlur stdDeviation="${(k * 0.12).toFixed(2)}"/></filter>
</defs>
<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) skewY(${SKEW}) scale(${scale.toFixed(4)})" opacity="${op.toFixed(3)}">
  <image x="${(-lw / 2).toFixed(1)}" y="${(-lh / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" xlink:href="data:image/png;base64,${logoB64}" href="data:image/png;base64,${logoB64}" filter="url(#ink)" opacity="0.96"/>
  <g mask="url(#m)">${sweep}</g>
  ${stars}
</g>
</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `f_${String(f).padStart(4, '0')}.png`));
  }
  console.log(JSON.stringify({ mode, frames: FRAMES, region: [cfg.rx, cfg.ry, cfg.rw, cfg.rh], logo: [Math.round(lw), Math.round(lh)] }));
})();
