/**
 * 카페24가 어떤 파일을 받아 주고 어떻게 내보내는지 한 번 확인한다(시험 파일은 끝나면 지운다).
 *   node scripts/cafe24-probe.ts <작은 mp4 파일>
 * 확인하는 것: .mp4 이름으로 올라가는가, 주소가 열리는가, 영상으로 내보내는가, .jpg 이름으로 올린 영상은 어떻게 나오는가, .json 은 되는가.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cafe24Remove, cafe24UploadAs } from '../src/lib/cafe24.ts';

process.loadEnvFile('.env.local');
const video = process.argv[2];
if (!video) {
  console.error('사용: node scripts/cafe24-probe.ts <작은 mp4 파일>');
  process.exit(1);
}
const json = path.join(os.tmpdir(), 'vc_probe.json');
fs.writeFileSync(json, JSON.stringify({ ok: true }));

async function probe(local: string, name: string) {
  try {
    const up = await cafe24UploadAs(local, '_probe', name);
    const head = await fetch(up.url, { method: 'HEAD' }).catch(() => null);
    const range = await fetch(up.url, { headers: { Range: 'bytes=0-99' } }).catch(() => null);
    console.log(`${name}: 올리기 성공 · 주소 HTTP ${head?.status ?? '응답 없음'} · 종류 ${head?.headers.get('content-type') ?? '-'} · 크기 ${head?.headers.get('content-length') ?? '-'} · 부분 요청 HTTP ${range?.status ?? '-'}`);
    await cafe24Remove(up.key);
  } catch (error) {
    console.log(`${name}: 올리기 실패 · ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

await probe(video, 'vc_probe.mp4');
await probe(video, 'vc_probe.jpg');
await probe(json, 'vc_probe.json');
await probe(json, 'vc_probe.txt');
