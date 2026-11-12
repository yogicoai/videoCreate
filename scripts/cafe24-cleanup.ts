/**
 * 카페24 올리는 폴더 아래의 빈 하위 폴더를 지운다(시험하다 남은 _probe 같은 것).
 *   node scripts/cafe24-cleanup.ts <하위 폴더 이름>
 * 폴더에 파일이 남아 있으면 지우지 않는다.
 */
import { Client } from 'basic-ftp';

process.loadEnvFile('.env.local');
const sub = (process.argv[2] ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
if (!sub) {
  console.error('사용: node scripts/cafe24-cleanup.ts <하위 폴더 이름>');
  process.exit(1);
}
const env = (name: string) => (process.env[name] ?? '').trim();
const dir = `/${env('CAFE24_UPLOAD_DIR').replace(/^\/+|\/+$/g, '')}/${sub}`;
const client = new Client(30_000);
try {
  await client.access({ host: env('CAFE24_FTP_HOST').replace(/^(https?|ftp):\/\//, '').replace(/\/$/, ''), port: Number(env('CAFE24_FTP_PORT')) || 21, user: env('CAFE24_FTP_USER'), password: env('CAFE24_FTP_PASS'), secure: false });
  const list = await client.list(dir);
  if (list.length) {
    console.log(`${dir} 안에 ${list.length}개가 있어 지우지 않았어요.`);
  } else {
    await client.removeEmptyDir(dir);
    console.log(`빈 폴더를 지웠어요: ${dir}`);
  }
} finally {
  client.close();
}
