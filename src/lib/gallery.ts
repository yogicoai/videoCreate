import crypto from 'node:crypto';
import { aspectToRatio } from './models.ts';
import { readFolderNotes, readShowcase } from './store.ts';
import type { GalleryFolder, LibraryResult, LibraryVideo, LibraryView, Project, ShowcaseItem } from './types.ts';

/** 같은 제작물인데 imgCreate 에서 이름이 갈라진 것을 하나로 모은다 */
const SAME_WORK: Record<string, string> = {
  '요기보 라운저 영상': '요기보 라운저 35초',
  '요기보 서포트 영상': '요기보 서포트 37초',
  '요기보 피라미드 숏츠용 · 이전 판': '요기보 피라미드 숏츠용',
  '쿠션감 숏츠 (편안함편 따라 만들기)': '요기보 쿠션감 숏츠 6초',
};

const folderId = (prefix: string, name: string) => `${prefix}${crypto.createHash('sha1').update(name).digest('hex').slice(0, 12)}`;

function finalOf(video: LibraryVideo): string {
  const name = video.project || video.folder || '기타';
  return SAME_WORK[name] ?? name;
}

/** 안에서 먼저 보여 줄 묶음 순서. 완성본이 위로 온다 */
function sectionRank(title: string): number {
  if (/최종|완성/.test(title)) return 0;
  if (/편집/.test(title)) return 1;
  if (/장면|원본/.test(title)) return 2;
  return 3;
}

function videoFolder(group: 'final' | 'ideas', title: string, videos: LibraryVideo[], desc: string): GalleryFolder {
  const bySection = new Map<string, LibraryVideo[]>();
  for (const video of videos) {
    const section = group === 'final' ? video.folder || '장면 · 시안' : video.project || '영상';
    bySection.set(section, [...(bySection.get(section) ?? []), video]);
  }
  const sections = [...bySection.entries()]
    .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]))
    .map(([sectionTitle, list]) => ({ title: sectionTitle, entries: list.map((video) => ({ kind: 'video' as const, video })) }));
  const coverVideo = sections.flatMap((s) => s.entries).find((e) => e.video.poster)?.video;
  return {
    id: folderId(group === 'final' ? 'f' : 'i', title),
    group,
    title,
    desc,
    count: videos.length,
    cover: coverVideo ? { url: coverVideo.poster, kind: 'image' } : null,
    sections,
  };
}

/**
 * 갤러리를 제작물 단위로 묶는다.
 * 앞으로 만드는 것은 프로젝트와 이어져 있고, imgCreate 에서 가져온 것은 제작물·기획 이름으로 묶는다.
 */
export function buildGallery(library: LibraryView, projects: Pick<Project, 'id' | 'name'>[]): GalleryFolder[] {
  const notes = readFolderNotes();
  const folders: GalleryFolder[] = [];

  const resultsByProject = new Map<string, LibraryResult[]>();
  for (const result of library.results) resultsByProject.set(result.projectId, [...(resultsByProject.get(result.projectId) ?? []), result]);
  for (const project of projects) {
    const results = resultsByProject.get(project.id);
    if (!results?.length) continue;
    const finals = results.filter((r) => r.stage === 'final');
    const edits = results.filter((r) => r.stage === 'edit');
    const videos = results.filter((r) => r.result.kind === 'video' && !r.stage);
    const images = results.filter((r) => r.result.kind === 'image');
    // 완성본이 있으면 그것을 표지로 쓴다
    const coverVideo = finals[0] ?? edits[0];
    const coverImage = coverVideo ? undefined : images[0];
    const firstVideo = coverVideo ?? videos[0];
    folders.push({
      id: `p${project.id}`,
      group: 'project',
      title: project.name,
      desc: '',
      projectId: project.id,
      count: results.length,
      cover: coverImage
        ? { url: `/api/projects/${project.id}/files/${coverImage.result.file}?w=960`, kind: 'image' }
        : firstVideo
          ? { url: `/api/projects/${project.id}/files/${firstVideo.result.file}`, kind: 'video' }
          : null,
      sections: [
        ...(finals.length ? [{ title: '완성본', entries: finals.map((result) => ({ kind: 'result' as const, result })) }] : []),
        ...(edits.length ? [{ title: '편집본', entries: edits.map((result) => ({ kind: 'result' as const, result })) }] : []),
        ...(videos.length ? [{ title: '영상', entries: videos.map((result) => ({ kind: 'result' as const, result })) }] : []),
        ...(images.length ? [{ title: '그림', entries: images.map((result) => ({ kind: 'result' as const, result })) }] : []),
      ],
    });
  }

  const group = (area: 'final' | 'ideas', keyOf: (video: LibraryVideo) => string) => {
    const map = new Map<string, LibraryVideo[]>();
    for (const video of library.videos) {
      if (video.area !== area) continue;
      const key = keyOf(video);
      map.set(key, [...(map.get(key) ?? []), video]);
    }
    return [...map.entries()]
      .map(([title, videos]) => videoFolder(area, title, videos, notes.notes[title] ?? ''))
      .sort((a, b) => {
        const rank = (title: string) => {
          const index = notes.order.indexOf(title);
          return index < 0 ? notes.order.length : index;
        };
        return rank(a.title) - rank(b.title);
      });
  };
  folders.push(...group('final', finalOf), ...group('ideas', (video) => video.folder || '기타'));
  return folders;
}

/** 사용자가 갤러리에서 고른 작업물만 메인에 건다 */
export function buildShowcase(library: LibraryView): ShowcaseItem[] {
  return readShowcase().flatMap((key): ShowcaseItem[] => {
    const id = key.slice(key.indexOf(':') + 1);
    if (key.startsWith('video:')) {
      const video = library.videos.find((v) => v.id === id);
      if (!video) return [];
      return [{ key, title: video.title, poster: video.poster, ratio: aspectToRatio(video.aspect), url: `/api/library/videos/${video.id}`, kind: 'video', meta: video.project, note: video.summary }];
    }
    const item = library.results.find((r) => r.jobId === id);
    if (!item) return [];
    const url = `/api/projects/${item.projectId}/files/${item.result.file}`;
    return [
      {
        key,
        title: item.title,
        poster: item.result.kind === 'image' ? `${url}?w=480` : '',
        ratio: item.result.width ? item.result.width / item.result.height : 16 / 9,
        url,
        kind: item.result.kind,
        meta: item.projectName,
        note: '',
      },
    ];
  });
}
