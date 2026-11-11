// 요기보 끝 카드: 흰 화면 가운데 yogibo 로고(0.2초에 걸쳐 나타남) + 「요기보!」 외침(0.12초 뒤, +13dB). 1080×1920, 24fps.
// 사용(저장소 맨 위에서): node scripts/edit/endcard.cjs <출력 파일> [초=1.75] [로고 너비 px=400]
// 키트: data/library/kits/yogibo-endcard/ (로고·음성). 크레딧 0.
const { execFileSync } = require('child_process');
const KIT = 'data/library/kits/yogibo-endcard/';
const [out, secArg, widthArg] = process.argv.slice(2);
if (!out) { console.error('사용: node scripts/edit/endcard.cjs <출력 파일> [초=1.75] [로고 너비 px=400]'); process.exit(1); }
const SEC = Number(secArg ?? 1.75), LW = Number(widthArg ?? 400), FPS = 24;
const frames = Math.round(SEC * FPS);
const graph =
  `color=c=white:s=1080x1920:r=${FPS}:d=${SEC}[w];` +
  `[0:v]scale=${LW}:-1:flags=lanczos,format=rgba,fade=t=in:st=0:d=0.2:alpha=1[l];[w][l]overlay=(W-w)/2:(H-h)/2:shortest=0,format=yuv420p[v];` +
  `[1:a]aresample=48000,volume=13dB,alimiter=limit=0.89:level=false,adelay=120|120,apad,atrim=duration=${SEC}[a]`;
const isMov = /\.mov$/i.test(out);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-i', KIT + 'yogibo-logo.png', '-i', KIT + 'yogibo-voice.wav',
  '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-frames:v', String(frames),
  '-c:v', 'libx264', '-crf', isMov ? '12' : '17', '-pix_fmt', 'yuv420p', ...(isMov ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k']), '-ar', '48000', '-ac', '2', out], { stdio: 'inherit' });
console.log('끝 카드', out, `${SEC}초`);
