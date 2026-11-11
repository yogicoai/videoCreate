/**
 * imgCreate 작업물을 자산으로 가져온다. imgCreate 는 읽기만 하고 고치지 않는다.
 *
 *   npm run import:imgcreate
 *
 * 읽는 곳
 *   data/import/imgcreate-export.json        영상 목록과 스토리보드 (DB에서 읽기 전용으로 내보낸 것)
 *   <imgCreate>/src/app/ideas/data.json      기획안
 *   <imgCreate>/src/app/video/process/data.json 제작 기록
 *   <imgCreate>/public/video-process/        제작 기록의 프레임
 *   data/import/imgcreate-cf-refs.json       CF 레퍼런스 (DB에서 읽기 전용으로 내보낸 것)
 *   <imgCreate>/src/app/ideas/cf-refs/previews/data.json  CF 예상 장면
 *
 * 영상 파일은 복사하지 않는다. 볼 때는 원래 자리에서 스트리밍하고, 참조로 쓸 때만 내려받는다.
 * 제품은 주소 목록만 둔다. 대화에서 "맥스 써 줘"라고 하면 그때 사진을 받아 칸으로 잇는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../src/lib/store.ts';
import type { CfConcept, CfRef, LibraryBoard, LibraryIdea, LibraryModel, LibraryVideo, LibraryWork, ProductEntry } from '../src/lib/types.ts';

const IMG = process.env.IMGCREATE_DIR || path.resolve(process.cwd(), '..', 'imgCreate');
const dataRoot = process.env.VIDEOCREATE_DATA_DIR || path.join(process.cwd(), 'data');
const EXPORT_FILE = process.env.IMGCREATE_EXPORT || path.join(dataRoot, 'import', 'imgcreate-export.json');

type ExportFile = {
  publicBase: string;
  videos: {
    id: string;
    title?: string;
    project?: string;
    folder?: string;
    summary?: string;
    aspect?: string;
    key?: string;
    poster?: string;
    area?: string;
    createdAt?: string;
  }[];
  storyboards: {
    _id: string;
    title?: string;
    scenario?: string;
    aspect?: string;
    total?: number;
    sheet?: string;
    hidden?: boolean;
    shots?: { no?: number; seconds?: number; scene?: string; action?: string; camera?: string; image?: string; imageTitle?: string }[];
  }[];
  talents?: {
    code: string;
    category: string;
    name?: string;
    identity?: string;
    identityEn?: string;
    size?: string;
    sizeEn?: string;
    rep?: string;
    sheets?: { face?: string; expr?: string; body?: string };
    exprSheet?: string;
    outfits?: { code: string; desc?: string; imageUrl?: string; cropUrl?: string }[];
  }[];
  products?: {
    itemId: string;
    name: string;
    category?: string;
    line?: string | null;
    scalePrompt?: string;
    colors?: { color?: string; views?: Record<string, string> }[];
  }[];
  videoFolders?: { name: string; sections?: { project: string; desc?: string }[] }[];
  ideaFolders?: { name: string; desc?: string }[];
};

function readIfExists<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
}

/** 제목 앞의 [묶음] 표시는 폴더와 겹치므로 뺀다 */
const cleanTitle = (title: string | undefined) => (title ?? '무제').replace(/^\[[^\]]*\]\s*/, '');

const safeId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32) || 'item';

const exported = readIfExists<ExportFile>(EXPORT_FILE);
const origin = exported?.publicBase ? new URL(exported.publicBase).origin : '';

const videos: LibraryVideo[] = (exported?.videos ?? [])
  .filter((v) => v.key)
  .map((v) => ({
    id: `l_v${safeId(v.id)}`,
    kind: 'video',
    source: 'imgcreate',
    title: cleanTitle(v.title),
    area: v.area === 'ideas' ? 'ideas' : 'final',
    folder: v.folder ?? '',
    project: v.project ?? '',
    summary: v.summary ?? '',
    aspect: v.aspect ?? '9:16',
    key: v.key as string,
    origin,
    poster: v.poster ?? '',
    createdAt: v.createdAt ?? null,
  }));

// 숨긴 스토리보드는 imgCreate 에서도 안 보이는 시험본이라 가져오지 않는다
const boards: LibraryBoard[] = (exported?.storyboards ?? [])
  .filter((s) => !s.hidden && s.shots?.length)
  .map((s) => ({
    id: `l_b${safeId(String(s._id))}`,
    kind: 'storyboard',
    source: 'imgcreate',
    title: s.title ?? '스토리보드',
    scenario: s.scenario ?? '',
    aspect: s.aspect ?? '9:16',
    total: s.total ?? 15,
    sheet: s.sheet ?? '',
    shots: (s.shots ?? []).map((shot, index) => ({
      no: shot.no ?? index + 1,
      seconds: shot.seconds ?? 3,
      scene: shot.scene ?? '',
      action: shot.action ?? '',
      camera: shot.camera ?? '',
      image: shot.image ?? '',
      title: shot.imageTitle ?? '',
    })),
  }));

const ideaFile = readIfExists<{
  ideas: {
    id: string;
    title: string;
    tag?: string;
    status?: string;
    logline?: string;
    hook?: string;
    beats?: string[];
    assets?: string;
    length?: string;
    why?: string;
    risk?: string;
    images?: { url: string; caption?: string }[];
  }[];
}>(path.join(IMG, 'src', 'app', 'ideas', 'data.json'));

const ideas: LibraryIdea[] = (ideaFile?.ideas ?? []).map((idea) => ({
  id: `l_i${safeId(idea.id)}`,
  kind: 'idea',
  source: 'imgcreate',
  title: idea.title,
  tag: idea.tag ?? '',
  status: idea.status ?? '',
  logline: idea.logline ?? '',
  hook: idea.hook ?? '',
  beats: idea.beats ?? [],
  assets: idea.assets ?? '',
  length: idea.length ?? '',
  why: idea.why ?? '',
  risk: idea.risk ?? '',
  images: (idea.images ?? []).map((m) => ({ url: m.url, caption: m.caption ?? '' })),
}));

const processFile = readIfExists<{
  works: {
    slug: string;
    title: string;
    kind?: string;
    aspect?: string;
    seconds?: number | string;
    reference?: { name?: string; what?: string } | null;
    lessons?: string[];
    frames?: { file: string; caption?: string }[];
  }[];
}>(path.join(IMG, 'src', 'app', 'video', 'process', 'data.json'));

const works: LibraryWork[] = (processFile?.works ?? []).map((work) => ({
  id: `l_w${safeId(work.slug)}`,
  kind: 'work',
  source: 'imgcreate',
  title: work.title,
  type: work.kind ?? '',
  aspect: work.aspect ?? '',
  seconds: String(work.seconds ?? ''),
  reference: [work.reference?.name, work.reference?.what].filter(Boolean).join(' — '),
  lessons: work.lessons ?? [],
  frames: (work.frames ?? []).flatMap((frame) => {
    const source = path.join(IMG, 'public', 'video-process', frame.file);
    if (!fs.existsSync(source)) return [];
    return [{ file: store.addLibraryFrame(frame.file, fs.readFileSync(source)), caption: frame.caption ?? '' }];
  }),
}));

const models: LibraryModel[] = (exported?.talents ?? [])
  .filter((t) => t.rep)
  .map((t) => ({
    id: `l_m${safeId(t.code)}`,
    kind: 'model',
    source: 'imgcreate',
    code: t.code,
    title: `${t.category} ${t.code.split('_').pop()}`,
    category: t.category,
    identity: t.identity ?? t.name ?? '',
    identityEn: t.identityEn ?? '',
    size: t.size ?? '',
    sizeEn: t.sizeEn ?? '',
    rep: t.rep as string,
    sheets: { face: t.sheets?.face, expr: t.exprSheet || t.sheets?.expr, body: t.sheets?.body },
    outfits: (t.outfits ?? []).map((o) => ({ code: o.code, desc: o.desc ?? '', image: o.cropUrl || o.imageUrl || '' })),
    createdAt: new Date().toISOString(),
  }));

store.ensureRules();
store.replaceImported([...models, ...ideas, ...boards, ...works, ...videos]);

const products: ProductEntry[] = (exported?.products ?? []).flatMap((product) => {
  const color = product.colors?.[0];
  const front = color?.views?.front;
  if (!front) return [];
  return [
    {
      id: product.itemId,
      name: product.name.replace(/_/g, ' '),
      category: product.category ?? '',
      line: product.line ?? '',
      color: color.color ?? '',
      front,
      views: color.views ?? {},
      scalePrompt: product.scalePrompt ?? '',
    },
  ];
});
store.saveProducts(products);

// 제작물 폴더의 순서와 설명. 앞에 있을수록 위에 보인다
const order: string[] = [];
const notes: Record<string, string> = {};
for (const folder of exported?.videoFolders ?? []) {
  for (const section of folder.sections ?? []) {
    if (!order.includes(section.project)) order.push(section.project);
    if (section.desc && folder.name === '최종본') notes[section.project] = section.desc;
  }
}
for (const folder of exported?.ideaFolders ?? []) {
  order.push(folder.name);
  if (folder.desc) notes[folder.name] = folder.desc;
}
store.saveFolderNotes({ order, notes });

const cfFile = path.join(dataRoot, 'import', 'imgcreate-cf-refs.json');
const cfRefs = readIfExists<{ refs: CfRef[] }>(cfFile)?.refs ?? [];
const conceptFile = readIfExists<{ concepts: CfConcept[] }>(path.join(IMG, 'src', 'app', 'ideas', 'cf-refs', 'previews', 'data.json'));
store.saveCfLibrary({ refs: cfRefs, concepts: conceptFile?.concepts ?? [] });

const finals = videos.filter((v) => v.area === 'final').length;
console.log(`가져왔어요: 모델 ${models.length}명, 제품 목록 ${products.length}개, 기획안 ${ideas.length}편, 스토리보드 ${boards.length}개, 제작 기록 ${works.length}편, 영상 제작물 ${finals}개, 레퍼런스 제작물 ${videos.length - finals}개, CF 레퍼런스 ${cfRefs.length}편, CF 예상 장면 ${conceptFile?.concepts.length ?? 0}편`);
