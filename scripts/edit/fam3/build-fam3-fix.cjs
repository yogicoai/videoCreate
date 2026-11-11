// 예시: 프로젝트 폴더에서 실행한다. 컷 프레임(228·343·453)은 가족 요기보 3탄 완성본 기준이다. 컷 위치는 프레임 차이(그레이 160×90, 평균 차이 18 넘는 곳)로 찾는다.
// 가족 요기보 3탄 완성본(24.58초)에서 3장면(프레임 228~342)과 4장면(343~452)만 새 영상으로 갈아 끼운다. 크레딧 0.
// 소리는 원본 완성본(음악) 그대로 쓴다. 새 영상(720p)은 lanczos로 1080p로 키우고 살짝 선명하게 한다.
// 사용: 프로젝트 폴더에서 node edit/build-fam3-fix.cjs <원본.mp4> <새3장면.mp4> <새4장면.mp4> <3장면 시작 프레임> <4장면 시작 프레임> <출력.mp4>
const { execFileSync } = require('child_process');
const [orig, s3, s4, a, b, out] = process.argv.slice(2);
const A = Number(a), B = Number(b);
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
const upOf = (f) => probe(f) === '1920' ? 'fps=24,format=yuv420p,setsar=1' : 'scale=1920:1080:flags=lanczos,unsharp=5:5:0.5:5:5:0.0,fps=24,format=yuv420p,setsar=1';
const g = [
  `[0:v]trim=start_frame=0:end_frame=228,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v1]`,
  `[1:v]fps=24,trim=start_frame=${A}:end_frame=${A + 115},setpts=PTS-STARTPTS,${upOf(s3)}[v3]`,
  `[2:v]fps=24,trim=start_frame=${B}:end_frame=${B + 110},setpts=PTS-STARTPTS,${upOf(s4)}[v4]`,
  `[0:v]trim=start_frame=453,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v5]`,
  `[v1][v3][v4][v5]concat=n=4:v=1:a=0[v]`,
].join(';');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', orig, '-i', s3, '-i', s4,
  '-filter_complex', g, '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '24',
  '-c:a', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log('편집본', out);
