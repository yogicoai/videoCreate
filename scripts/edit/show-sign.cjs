// 간판 영역을 4배로 키워 격자(10px)와 함께 저장한다. 판 모서리를 눈으로 재기 위한 것.
// 사용: node show-sign.cjs <프레임 png> <출력 png>
const sharp = require('sharp');
const [file, out] = process.argv.slice(2);
const X0 = 40, Y0 = 170, CW = 130, CH = 100, S = 5;
(async () => {
  const base = await sharp(file).resize(480, 854, { fit: 'fill' }).png().toBuffer(); const crop = await sharp(await sharp(base).extract({ left: X0, top: Y0, width: CW, height: CH }).png().toBuffer()).resize(CW * S, CH * S, { kernel: 'nearest' }).png().toBuffer(); console.log(JSON.stringify(await sharp(crop).metadata().then(m => [m.width, m.height])));
  let lines = '';
  for (let x = 0; x <= CW; x += 10) lines += `<line x1="${x * S}" y1="0" x2="${x * S}" y2="${CH * S}" stroke="${(X0 + x) % 50 === 0 ? '#0050ff' : '#00000055'}" stroke-width="1"/><text x="${x * S + 2}" y="12" font-size="11" fill="#003">${X0 + x}</text>`;
  for (let y = 0; y <= CH; y += 10) lines += `<line x1="0" y1="${y * S}" x2="${CW * S}" y2="${y * S}" stroke="${(Y0 + y) % 50 === 0 ? '#0050ff' : '#00000055'}" stroke-width="1"/><text x="2" y="${y * S - 2}" font-size="11" fill="#003">${Y0 + y}</text>`;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW * S}" height="${CH * S}">${lines}</svg>`);
  await sharp(crop).composite([{ input: await sharp(svg).resize(CW * S, CH * S).png().toBuffer() }]).png().toFile(out);
  console.log(out);
})();
