import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'basic-ftp';

/**
 * 카페24 FTP에 결과물을 올리고 공개 주소를 돌려준다. imgCreate 의 src/lib/ftp.ts 와 같은 방식이다.
 *
 * - 카페24는 한글 파일 이름을 못 읽는다(403). 이름은 영문·숫자로만 짓는다.
 * - 카페24는 .mp4 올리기를 막는다. 영상은 .jpg 이름으로 올린다(내용은 그대로 mp4).
 * - 설정은 .env.local 의 CAFE24_* 에서 읽는다. 값을 출력하거나 코드에 넣지 않는다.
 * - 올린 파일은 주소를 아는 누구나 볼 수 있다. 공개하면 안 되는 작업은 올리지 않는다.
 */

const env = (name: string) => (process.env[name] ?? '').trim();
const host = () => env('CAFE24_FTP_HOST').replace(/^(https?|ftp):\/\//, '').replace(/\/$/, '');
const uploadDir = () => env('CAFE24_UPLOAD_DIR').replace(/^\/+|\/+$/g, '');
const publicBase = () => env('CAFE24_PUBLIC_BASE_URL').replace(/\/+$/, '');

export function cafe24Configured(): boolean {
  return !!(host() && env('CAFE24_FTP_USER') && env('CAFE24_FTP_PASS') && uploadDir() && publicBase());
}

/** 공개 주소. 기본 주소에 올리는 폴더가 이미 들어 있으면 겹쳐 붙이지 않는다 */
export function cafe24Url(sub: string, name: string): string {
  const base = publicBase();
  let basePath = '';
  try {
    basePath = new URL(base).pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    basePath = '';
  }
  const dir = uploadDir();
  const prefix = basePath.endsWith(dir) ? base : `${base}/${dir}`;
  return [prefix, sub.replace(/^\/+|\/+$/g, ''), name].filter(Boolean).join('/');
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  if (!cafe24Configured()) throw new Error('카페24 설정(CAFE24_*)이 .env.local 에 다 들어 있지 않아요.');
  const client = new Client(60_000);
  try {
    await client.access({ host: host(), port: Number(env('CAFE24_FTP_PORT')) || 21, user: env('CAFE24_FTP_USER'), password: env('CAFE24_FTP_PASS'), secure: false });
    return await fn(client);
  } finally {
    client.close();
  }
}

/** 접속해서 올리는 폴더를 만들고(없으면) 안에 든 파일 수를 센다 */
export async function cafe24Check(): Promise<{ dir: string; count: number }> {
  return withClient(async (client) => {
    await client.ensureDir(`/${uploadDir()}`);
    const list = await client.list();
    return { dir: `/${uploadDir()}`, count: list.length };
  });
}

export type Cafe24Upload = { key: string; url: string; bytes: number; disguised: boolean };

/**
 * 파일 하나를 올린다. 영상은 .jpg 이름으로 바꿔 올린다.
 * @param sub 올리는 폴더 아래 하위 폴더(예: 2026-11)
 * @param baseName 확장자 없는 영문 이름
 */
export async function cafe24Upload(localPath: string, sub: string, baseName: string): Promise<Cafe24Upload> {
  const ext = path.extname(localPath).slice(1).toLowerCase();
  const isVideo = ['mp4', 'mov', 'webm', 'm4v'].includes(ext);
  const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || `file_${Date.now()}`;
  const name = `${safeBase}.${isVideo ? 'jpg' : ext || 'bin'}`;
  const cleanSub = sub.replace(/[^a-zA-Z0-9_/-]/g, '_').replace(/^\/+|\/+$/g, '');
  const bytes = fs.statSync(localPath).size;
  await withClient(async (client) => {
    await client.ensureDir(`/${[uploadDir(), cleanSub].filter(Boolean).join('/')}`);
    await client.uploadFrom(localPath, name);
  });
  return { key: [uploadDir(), cleanSub, name].filter(Boolean).join('/'), url: cafe24Url(cleanSub, name), bytes, disguised: isVideo };
}

/** 이름을 그대로 두고 올린다(목록 파일이나 시험용). 이름은 영문·숫자여야 한다 */
export async function cafe24UploadAs(localPath: string, sub: string, name: string): Promise<{ key: string; url: string }> {
  const cleanSub = sub.replace(/[^a-zA-Z0-9_/-]/g, '_').replace(/^\/+|\/+$/g, '');
  await withClient(async (client) => {
    await client.ensureDir(`/${[uploadDir(), cleanSub].filter(Boolean).join('/')}`);
    await client.uploadFrom(localPath, name);
  });
  return { key: [uploadDir(), cleanSub, name].filter(Boolean).join('/'), url: cafe24Url(cleanSub, name) };
}

/** 올린 파일을 지운다 */
export async function cafe24Remove(key: string): Promise<void> {
  await withClient(async (client) => {
    await client.remove(`/${key.replace(/^\/+/, '')}`);
  });
}
