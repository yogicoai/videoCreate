'use client';

import { ChevronLeft, Film, FolderOpen, Play, Star } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api, fileUrl, formatDate, videoUrl } from '@/lib/client';
import { aspectToRatio, ENGINE_INFO, formatCost } from '@/lib/models';
import type { GalleryEntry, GalleryFolder, GalleryGroup } from '@/lib/types';
import { Lightbox, type LightboxItem } from './Lightbox';

type FolderCard = Omit<GalleryFolder, 'sections'>;

const GROUPS: { group: GalleryGroup; title: string; note: string }[] = [
  { group: 'project', title: '내 프로젝트', note: '여기서 만든 것은 프로젝트와 이어져 있어요.' },
  { group: 'final', title: '영상 제작물', note: 'imgCreate 에서 만든 제작물이에요.' },
  { group: 'ideas', title: '레퍼런스 제작물', note: '기획안을 시험해 본 영상이에요.' },
];

export function GalleryFolders({ folders }: { folders: FolderCard[] }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim();
    return q ? folders.filter((f) => `${f.title} ${f.desc}`.includes(q)) : folders;
  }, [folders, query]);

  if (!folders.length) {
    return <p className="rounded-2xl border border-line bg-fill-2 px-5 py-10 text-center text-[14px] text-ink-2">아직 완성된 결과가 없어요. 장면이나 영상이 완성되면 프로젝트별로 여기에 모여요.</p>;
  }

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="제작물 찾기" placeholder="제작물 이름으로 찾기" className="field mb-7 h-9 w-[260px]" />
      {GROUPS.map(({ group, title, note }) => {
        const list = shown.filter((f) => f.group === group);
        if (!list.length) return null;
        return (
          <section key={group} className="mb-10" aria-label={title}>
            <div className="mb-3.5 flex items-baseline gap-2.5">
              <h2 className="text-[16px] font-semibold">{title}</h2>
              <span className="text-[13px] text-ink-3">{list.length}개</span>
              <span className="text-[12px] text-ink-3">{note}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-5 gap-y-7">
              {list.map((folder) => (
                <FolderTile key={folder.id} folder={folder} />
              ))}
            </div>
          </section>
        );
      })}
      {!shown.length ? <p className="text-[14px] text-ink-2">맞는 제작물이 없어요.</p> : null}
    </>
  );
}

function FolderTile({ folder }: { folder: FolderCard }) {
  return (
    <Link href={`/gallery/${folder.id}`} className="group block min-w-0" aria-label={`${folder.title} 열기, ${folder.count}개`}>
      {/* 뒤에 얇게 겹친 판 두 장으로 묶음임을 보여 준다 */}
      <span className="relative block pt-2">
        <span className="absolute inset-x-5 top-0 h-6 rounded-t-xl border border-b-0 border-line bg-fill-2" />
        <span className="absolute inset-x-2.5 top-1 h-6 rounded-t-xl border border-b-0 border-line bg-fill" />
        <span className="relative block aspect-video overflow-hidden rounded-xl bg-fill ring-1 ring-line transition-all duration-200 group-hover:-translate-y-0.5 group-hover:ring-line-strong">
          {folder.cover?.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={folder.cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : folder.cover?.kind === 'video' ? (
            <video src={folder.cover.url} preload="metadata" muted className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-ink-4">
              <Film size={30} strokeWidth={1.4} />
            </span>
          )}
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[12px] font-semibold text-white backdrop-blur-sm">
            <FolderOpen size={12} />
            {folder.count}
          </span>
        </span>
      </span>
      <span className="mt-2.5 block truncate text-[14px] font-semibold text-ink">{folder.title}</span>
      {folder.desc ? <span className="line-clamp-2 mt-0.5 block text-[12px] leading-[1.45] text-ink-3">{folder.desc}</span> : null}
    </Link>
  );
}

const ROW_HEIGHT = 210;

function entryInfo(entry: GalleryEntry, projectTitle: string) {
  if (entry.kind === 'video') {
    const { video } = entry;
    return {
      key: video.id,
      title: video.title,
      ratio: Math.min(aspectToRatio(video.aspect), 2.4),
      sub: video.aspect,
      thumb: video.poster,
      isVideo: true,
      videoSrc: videoUrl(video.id),
      open: { url: videoUrl(video.id), kind: 'video', title: video.title, poster: video.poster || undefined, meta: video.project, note: video.summary } satisfies LightboxItem,
    };
  }
  const { result: item } = entry;
  const isVideo = item.result.kind === 'video';
  const ratio = item.result.width ? item.result.width / item.result.height : 16 / 9;
  // 편집본과 완성본은 엔진이 뽑은 것이 아니다
  const cost = item.stage ? (item.stage === 'final' ? '완성본' : '편집본') : `${ENGINE_INFO[item.engine].short} · ${item.costIsActual ? '' : '추정 '}${formatCost(item.cost)}`;
  return {
    key: item.jobId,
    title: item.title,
    ratio: Math.min(ratio, 2.4),
    sub: `${formatDate(item.finishedAt)} · ${cost}`,
    thumb: isVideo ? '' : fileUrl(item.projectId, item.result.file, 480),
    isVideo,
    videoSrc: fileUrl(item.projectId, item.result.file),
    open: { url: fileUrl(item.projectId, item.result.file), kind: item.result.kind, title: item.title, meta: `${projectTitle} · ${cost}` } satisfies LightboxItem,
  };
}

export function GalleryFolderView({ folder, showcase }: { folder: GalleryFolder; showcase: string[] }) {
  const [open, setOpen] = useState<LightboxItem | null>(null);
  const [picked, setPicked] = useState(() => new Set(showcase));

  const toggle = async (key: string) => {
    const on = !picked.has(key);
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    await api('/api/showcase', { method: 'POST', body: { key, on } });
  };
  return (
    <>
      <Link href="/gallery" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
        <ChevronLeft size={15} />
        갤러리
      </Link>
      <div className="mb-7 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">{folder.title}</h1>
          {folder.desc ? <p className="mt-1 max-w-[780px] text-[14px] leading-[1.55] text-ink-2">{folder.desc}</p> : null}
        </div>
        {folder.projectId ? (
          <Link href={`/p/${folder.projectId}`} className="btn btn-primary ml-auto">
            프로젝트 열기
          </Link>
        ) : null}
      </div>
      {folder.sections.map((section) => (
        <section key={section.title} className="mb-9" aria-label={section.title}>
          <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold">
            {section.title}
            <span className="text-[13px] font-normal text-ink-3">{section.entries.length}</span>
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-5">
            {section.entries.map((entry) => {
              const info = entryInfo(entry, folder.title);
              const width = Math.round(ROW_HEIGHT * info.ratio);
              const showKey = `${entry.kind === 'video' ? 'video' : 'result'}:${info.key}`;
              const isPicked = picked.has(showKey);
              return (
                <figure key={info.key} style={{ width }} className="group relative min-w-0 max-w-full">
                  <button
                    type="button"
                    aria-label={isPicked ? `${info.title} 메인에서 내리기` : `${info.title} 메인에 걸기`}
                    aria-pressed={isPicked}
                    title={isPicked ? '메인에서 내리기' : '메인에 걸기'}
                    onClick={() => void toggle(showKey)}
                    className={`absolute right-1.5 top-1.5 z-[1] flex h-8 w-8 items-center justify-center rounded-lg bg-black/65 backdrop-blur-sm transition-opacity hover:bg-black/85 focus-visible:opacity-100 group-hover:opacity-100 ${
                      isPicked ? 'text-wait opacity-100' : 'text-white opacity-0'
                    }`}
                  >
                    <Star size={15} fill={isPicked ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${info.title} ${info.isVideo ? '재생' : '크게 보기'}`}
                    onClick={() => setOpen(info.open)}
                    style={{ height: ROW_HEIGHT }}
                    className="relative block w-full overflow-hidden rounded-xl bg-fill ring-1 ring-line transition-all duration-200 hover:-translate-y-0.5 hover:ring-line-strong"
                  >
                    {info.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={info.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <video src={info.videoSrc} preload="metadata" muted className="h-full w-full object-cover" />
                    )}
                    {info.isVideo ? (
                      <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                        <Play size={18} fill="currentColor" className="ml-0.5" />
                      </span>
                    ) : null}
                  </button>
                  <figcaption className="mt-2">
                    <p className="line-clamp-2 text-[13px] font-medium leading-[1.4] text-ink" title={info.title}>
                      {info.title}
                    </p>
                    <p className="truncate text-[12px] text-ink-3">{info.sub}</p>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
      {open ? <Lightbox item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
