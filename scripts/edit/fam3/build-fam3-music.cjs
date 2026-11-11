// 예시: 프로젝트 폴더에서 실행한다. atempo·볼륨은 25초 ElevenLabs 곡을 24.6초 영상에 맞춘 값이다.
// 완성 영상(편집본 v2)의 소리를 새 연주곡으로 바꾼다. 크레딧 0.
// 곡을 4% 느리게(atempo 0.96) 늘려 잦아드는 끝을 영상 끝(24.6초)에 맞추고, 원래 음원과 같은 크기(약 −14.6 LUFS)로 맞춘다.
// 사용: 프로젝트 폴더에서 node edit/build-fam3-music.cjs <영상.mp4> <곡.mp3> <출력.mp4>
const { execFileSync } = require('child_process');
const [video, music, out] = process.argv.slice(2);
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim();
const a = `[1:a]aresample=48000,atempo=0.96,volume=-2.2dB,atrim=0:${dur},afade=t=out:st=${(Number(dur) - 0.8).toFixed(2)}:d=0.8[a]`;
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', music, '-filter_complex', a,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', dur, '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log('음원 입힌 영상', out, dur + '초');
