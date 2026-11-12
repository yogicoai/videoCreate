/**
 * 결과물을 카페24에 올리고 공개 주소를 기록한다. 크레딧이 들지 않는다.
 * 올린 파일은 주소를 아는 누구나 볼 수 있으니, 공개하면 안 되는 작업은 --skip 으로 뺀다.
 *
 *   npm run cafe24                       완성본 목록과 올림 여부
 *   npm run cafe24 -- test               접속 확인(올리는 폴더를 만들고 파일 수를 센다)
 *   npm run cafe24 -- sync [--skip <프로젝트 id,...>]   아직 안 올린 완성본을 모두 올린다
 *   npm run cafe24 -- upload <job>       결과물 하나를 올린다(완성본이 아니어도 된다)
 *   npm run cafe24 -- remove <job>       올린 파일을 지우고 기록에서 뺀다
 *   npm run cafe24 -- snapshot [--library none|final|all]
 *                                        온라인 보기 전용 판에 실을 기록 사본(online-data/)을 만든다
 *
 * 기록은 data/library/cafe24.json 에 남는다. 영상은 .jpg 이름으로 올라간다(카페24가 .mp4 를 막는다).
 * 사본에는 올린 결과물이 있는 프로젝트만 들어가고, 프롬프트·잔액·자산·기획안은 넣지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cafe24Check, cafe24Configured, cafe24Remove, cafe24Upload } from '../src/lib/cafe24.ts';
import * as store from '../src/lib/store.ts';

try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local 이 없으면 아래에서 설정이 없다고 알린다
}

type Item = {
  jobId: string;
  projectId: string;
  projectName: string;
  title: string;
  kind: 'image' | 'video';
  stage: string;
  /** 프로젝트 안의 파일 이름. 온라인 판이 이 이름으로 찾는다 */
  file: string;
  mime: string;
  key: string;
  url: string;
  bytes: number;
  disguised: boolean;
  uploadedAt: string;
};
const DATA = 'data';
const SNAP = 'online-data';
const indexFile = path.join(DATA, 'library', 'cafe24.json');
const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
};
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
};
const readIndex = () => readJson<{ items?: Record<string, Item> }>(indexFile, {}).items ?? {};
const writeIndex = (items: Record<string, Item>) => writeJson(indexFile, { items });

const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : undefined;
};
const die = (message: string): never => {
  console.error(`오류: ${message}`);
  process.exit(1);
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

const results = store.listLibrary().results;
const finals = results.filter((r) => r.stage === 'final');

async function uploadOne(jobId: string, items: Record<string, Item>): Promise<Item> {
  const r = results.find((x) => x.jobId === jobId) ?? die(`결과물을 찾지 못했어요: ${jobId}`);
  const local = store.filePath(r.projectId, r.result.file);
  const month = (r.finishedAt || new Date().toISOString()).slice(0, 7);
  const up = await cafe24Upload(local, month, `vc_${r.projectId}_${r.jobId}`);
  const res = await fetch(up.url, { method: 'HEAD' }).catch(() => null);
  if (!res?.ok) console.log(`  주의: 올렸지만 주소가 열리지 않아요 (HTTP ${res?.status ?? '응답 없음'}). CAFE24_PUBLIC_BASE_URL 을 확인해 주세요.`);
  const item: Item = {
    jobId: r.jobId,
    projectId: r.projectId,
    projectName: r.projectName,
    title: r.title,
    kind: r.result.kind,
    stage: r.stage ?? '',
    file: r.result.file,
    mime: r.result.mime,
    ...up,
    uploadedAt: new Date().toISOString(),
  };
  items[r.jobId] = item;
  writeIndex(items);
  return item;
}

/** 예전 기록에 파일 이름이 없으면 채운다 */
function backfill(items: Record<string, Item>): void {
  let changed = false;
  for (const item of Object.values(items)) {
    if (item.file && item.mime) continue;
    const r = results.find((x) => x.jobId === item.jobId);
    if (!r) continue;
    item.file = r.result.file;
    item.mime = r.result.mime;
    changed = true;
  }
  if (changed) writeIndex(items);
}

const stripPrompts = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value, (key, v) => (key === 'prompt' || key === 'finalPrompt' ? '' : v))) as T;

/** 온라인 판에 실을 기록 사본. 올린 결과물이 있는 프로젝트의 기록만, 프롬프트를 지워서 넣는다 */
function snapshot(items: Record<string, Item>): void {
  const mode = option('library') ?? 'none';
  if (!['none', 'final', 'all'].includes(mode)) die('--library 는 none, final, all 중 하나예요.');
  fs.rmSync(SNAP, { recursive: true, force: true });
  const projectIds = [...new Set(Object.values(items).map((i) => i.projectId))];
  for (const id of projectIds) {
    const from = path.join(DATA, 'projects', id);
    const to = path.join(SNAP, 'projects', id);
    for (const name of ['project.json', 'jobs.json', 'boards.json', 'files.json']) {
      if (fs.existsSync(path.join(from, name))) writeJson(path.join(to, name), stripPrompts(readJson<unknown>(path.join(from, name), null)));
    }
    for (const name of fs.existsSync(path.join(from, 'canvases')) ? fs.readdirSync(path.join(from, 'canvases')) : []) {
      if (name.endsWith('.json')) writeJson(path.join(to, 'canvases', name), stripPrompts(readJson<unknown>(path.join(from, 'canvases', name), null)));
    }
  }
  // 자산·기획안·모델은 넣지 않는다. 규칙은 없으면 앱이 새로 쓰려고 해서 넣고, 가져온 영상은 고른 범위만 넣는다
  const library = readJson<{ kind: string; area?: string }[]>(path.join(DATA, 'library', 'library.json'), []);
  const kept = library.filter((i) => i.kind === 'rule' || (i.kind === 'video' && (mode === 'all' || (mode === 'final' && i.area === 'final'))));
  writeJson(path.join(SNAP, 'library', 'library.json'), kept);
  writeJson(path.join(SNAP, 'library', 'cafe24.json'), { items });
  if (fs.existsSync(path.join(DATA, 'library', 'showcase.json'))) fs.copyFileSync(path.join(DATA, 'library', 'showcase.json'), path.join(SNAP, 'library', 'showcase.json'));
  // 폴더 설명에는 내부 메모가 섞여 있어 순서만 넣는다
  const notes = readJson<{ order?: string[] }>(path.join(DATA, 'library', 'folder-notes.json'), {});
  writeJson(path.join(SNAP, 'library', 'folder-notes.json'), { order: notes.order ?? [], notes: {} });
  const videos = kept.filter((i) => i.kind === 'video').length;
  console.log(`사본을 만들었어요: ${SNAP}/ · 프로젝트 ${projectIds.length}개 · 올린 결과물 ${Object.keys(items).length}개 · 가져온 영상 ${videos}개`);
}

async function main() {
  const needsFtp = ['test', 'sync', 'upload', 'remove'].includes(command ?? '');
  if (needsFtp && !cafe24Configured()) die('카페24 설정(CAFE24_*)이 .env.local 에 다 들어 있지 않아요.');
  const items = readIndex();
  backfill(items);
  switch (command) {
    case undefined:
    case 'list': {
      for (const r of finals) {
        const done = items[r.jobId];
        console.log(`${done ? '[올림]' : '[아직]'} ${r.jobId}  ${r.projectId}  ${r.projectName} / ${r.title}  ${r.result.kind === 'video' ? '영상' : '그림'} ${mb(r.result.bytes)}${done ? `\n        ${done.url}` : ''}`);
      }
      console.log(`\n완성본 ${finals.length}개 · 올린 것 ${finals.filter((r) => items[r.jobId]).length}개`);
      break;
    }
    case 'test': {
      const { dir, count } = await cafe24Check();
      console.log(`접속했어요. 올리는 폴더 ${dir} 안에 ${count}개가 있어요.`);
      break;
    }
    case 'sync': {
      const skip = new Set((option('skip') ?? '').split(',').filter(Boolean));
      for (const r of finals) {
        if (items[r.jobId]) continue;
        if (skip.has(r.projectId)) {
          console.log(`건너뜀: ${r.projectName} / ${r.title}`);
          continue;
        }
        const item = await uploadOne(r.jobId, items);
        console.log(`올렸어요: ${r.projectName} / ${r.title} (${mb(item.bytes)})\n  ${item.url}`);
      }
      break;
    }
    case 'upload': {
      const item = await uploadOne(rest[0] ?? die('npm run cafe24 -- upload <job>'), items);
      console.log(`올렸어요: ${item.projectName} / ${item.title} (${mb(item.bytes)})\n  ${item.url}`);
      break;
    }
    case 'remove': {
      const item = items[rest[0] ?? ''] ?? die('올린 기록이 없어요.');
      await cafe24Remove(item.key);
      delete items[item.jobId];
      writeIndex(items);
      console.log(`지웠어요: ${item.projectName} / ${item.title}`);
      break;
    }
    case 'snapshot': {
      snapshot(items);
      break;
    }
    default:
      die(`모르는 명령이에요: ${command}`);
  }
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
