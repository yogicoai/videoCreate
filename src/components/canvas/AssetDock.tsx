'use client';

import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ASSET_DRAG_TYPE } from '@/lib/client';
import type { AssetView, LibraryBoard, LibraryIdea, LibraryModel, LibraryRule, LibraryVideo, LibraryView } from '@/lib/types';

export type AssetPayload =
  | { kind: 'image'; asset: AssetView }
  | { kind: 'model'; model: LibraryModel }
  | { kind: 'video'; video: LibraryVideo }
  | { kind: 'idea'; idea: LibraryIdea }
  | { kind: 'storyboard'; board: LibraryBoard }
  | { kind: 'rule'; rule: LibraryRule };

type Tab = 'all' | 'character' | 'background' | 'rule' | 'plan' | 'video';

const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'character', label: '모델' },
  { value: 'background', label: '배경' },
  { value: 'rule', label: '규칙' },
  { value: 'plan', label: '기획' },
  { value: 'video', label: '내 영상' },
];

const PREVIEW_COUNT = 4;

/**
 * 왼쪽 자산 판. 눌러서 넣거나 캔버스로 끌어다 놓는다. 칸 위에 놓으면 바로 이어진다.
 */
export function AssetDock({
  library,
  activeRuleId,
  onUse,
  onOpenVideo,
}: {
  library: LibraryView | null;
  activeRuleId?: string;
  onUse: (payload: AssetPayload) => void;
  onOpenVideo: (video: LibraryVideo) => void;
}) {
  const [open, setOpen] = useState(true);
  // 태블릿에서는 캔버스를 가리지 않게 접어 두고 시작한다
  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.innerWidth < 1100) setOpen(false);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');

  const match = useMemo(() => {
    const q = query.trim();
    return (...texts: (string | undefined)[]) => !q || texts.some((t) => t?.includes(q));
  }, [query]);

  if (!open) {
    return (
      <button
        type="button"
        aria-label="자산 판 열기"
        title="자산 판 열기"
        onClick={() => setOpen(true)}
        className="floating absolute left-4 top-[86px] z-[6] flex h-11 w-11 items-center justify-center text-ink-2 hover:text-ink"
      >
        <ChevronRight size={18} />
      </button>
    );
  }

  const models = library?.models.filter((m) => match(m.title, m.identity, m.category)) ?? [];
  const people = library?.images.filter((a) => a.type !== 'background' && match(a.title)) ?? [];
  const backgrounds = library?.images.filter((a) => a.type === 'background' && match(a.title)) ?? [];
  const rules = library?.rules.filter((r) => match(r.title)) ?? [];
  const ideas = library?.ideas.filter((i) => match(i.title, i.logline, i.tag)) ?? [];
  const boards = library?.boards.filter((b) => match(b.title, b.scenario)) ?? [];
  const videos = library?.videos.filter((v) => match(v.title, v.project, v.folder)) ?? [];

  const show = (name: Tab) => tab === 'all' || tab === name;
  const limit = <T,>(list: T[]): T[] => (tab === 'all' && !query ? list.slice(0, PREVIEW_COUNT) : list);

  const dragProps = (payload: AssetPayload) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(payload));
    },
    onClick: () => onUse(payload),
  });

  return (
    <aside data-asset-dock className="floating absolute bottom-4 left-4 top-[86px] z-[6] flex w-[252px] flex-col" aria-label="자산">
      <div className="flex items-center px-3.5 pt-3">
        <h2 className="text-[14px] font-semibold">자산</h2>
        <button type="button" className="icon-btn ml-auto h-7 w-7" aria-label="자산 판 닫기" onClick={() => setOpen(false)}>
          <ChevronLeft size={16} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1 px-3 pt-2" role="group" aria-label="자산 종류">
        {TABS.map((item) => (
          <button key={item.value} type="button" className="chip" aria-pressed={tab === item.value} onClick={() => setTab(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="px-3 pt-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="자산 찾기" placeholder="찾기" className="field h-8 w-full" />
      </div>
      <div className="thin-scroll mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!library ? <p className="py-4 text-[12px] text-ink-3">자산을 불러오고 있어요.</p> : null}

        {show('character') && (models.length || people.length) ? (
          <Section title="내 모델" count={models.length + people.length}>
            <div className="grid grid-cols-2 gap-2">
              {limit(models).map((model) => (
                <button key={model.id} type="button" {...dragProps({ kind: 'model', model })} title={model.identity} className="min-w-0 text-left text-[11.5px] text-ink-2 hover:text-ink">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={model.rep} alt="" loading="lazy" draggable={false} className="mb-1 aspect-[4/3] w-full rounded-lg object-cover object-top ring-1 ring-line" />
                  <span className="block truncate">{model.title}</span>
                </button>
              ))}
              {limit(people).map((asset) => (
                <ImageTile key={asset.key} asset={asset} {...dragProps({ kind: 'image', asset })} />
              ))}
            </div>
          </Section>
        ) : null}

        {show('background') && backgrounds.length ? (
          <Section title="배경 시트" count={backgrounds.length}>
            <div className="grid grid-cols-2 gap-2">
              {limit(backgrounds).map((asset) => (
                <ImageTile key={asset.key} asset={asset} {...dragProps({ kind: 'image', asset })} />
              ))}
            </div>
          </Section>
        ) : null}

        {show('rule') && rules.length ? (
          <Section title="제작 규칙" count={rules.length}>
            <div className="grid gap-2">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => onUse({ kind: 'rule', rule })}
                  aria-pressed={rule.id === activeRuleId}
                  className={`rounded-[10px] border p-2.5 text-left text-[12px] leading-[1.5] text-ink-2 transition-colors ${
                    rule.id === activeRuleId ? 'border-[#818cf8] bg-brand-soft' : 'border-line bg-inset hover:border-line-strong'
                  }`}
                >
                  <b className="mb-0.5 block text-[12.5px] font-semibold text-ink">{rule.title}</b>
                  {rule.rule.aspect} · 필수 {rule.rule.elements.length}요소 · {rule.rule.sound.slice(0, 18)}
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        {show('plan') && (ideas.length || boards.length) ? (
          <Section title="내 기획" count={ideas.length + boards.length}>
            <div className="grid gap-2">
              {limit(boards).map((board) => (
                <button key={board.id} type="button" {...dragProps({ kind: 'storyboard', board })} className="flex items-center gap-2 text-left text-[12px] font-medium leading-[1.35] text-ink hover:text-brand-dark">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={board.sheet || board.shots[0]?.image} alt="" loading="lazy" draggable={false} className="h-11 w-11 flex-none rounded-lg object-cover ring-1 ring-line" />
                  <span className="min-w-0">
                    <span className="block truncate">{board.title}</span>
                    <small className="block text-[11px] font-normal text-ink-3">스토리보드 · {board.shots.length}컷</small>
                  </span>
                </button>
              ))}
              {limit(ideas).map((idea) => (
                <button key={idea.id} type="button" {...dragProps({ kind: 'idea', idea })} title={idea.logline} className="flex items-center gap-2 text-left text-[12px] font-medium leading-[1.35] text-ink hover:text-brand-dark">
                  {idea.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={idea.images[0].url} alt="" loading="lazy" draggable={false} className="h-11 w-11 flex-none rounded-lg object-cover ring-1 ring-line" />
                  ) : (
                    <span className="h-11 w-11 flex-none rounded-lg bg-inset ring-1 ring-line" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate">{idea.title}</span>
                    <small className="block truncate text-[11px] font-normal text-ink-3">
                      {idea.tag} · {idea.length}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        {show('video') && videos.length ? (
          <Section title="내 영상" count={videos.length}>
            <div className="grid gap-2">
              {limit(videos).map((video) => (
                <div key={video.id} className="flex items-center gap-2 text-[12px] font-medium leading-[1.35] text-ink">
                  <button
                    type="button"
                    aria-label={`${video.title} 재생`}
                    onClick={() => onOpenVideo(video)}
                    className="relative h-11 w-11 flex-none overflow-hidden rounded-lg bg-inset ring-1 ring-line"
                  >
                    {video.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={video.poster} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                    ) : null}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                      <Play size={13} fill="currentColor" />
                    </span>
                  </button>
                  <button type="button" {...dragProps({ kind: 'video', video })} title={`${video.title} · 눌러서 참조로 넣기`} className="min-w-0 flex-1 text-left hover:text-brand-dark">
                    <span className="block truncate">{video.title}</span>
                    <small className="block truncate text-[11px] font-normal text-ink-3">{video.area === 'final' ? '영상 제작물' : '레퍼런스 제작물'}</small>
                  </button>
                </div>
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </aside>
  );
}

function ImageTile({
  asset,
  ...rest
}: {
  asset: AssetView;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  return (
    <button type="button" {...rest} title={asset.title} className="min-w-0 text-left text-[11.5px] text-ink-2 hover:text-ink">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.thumb}
        alt=""
        loading="lazy"
        draggable={false}
        className="mb-1 aspect-[4/3] w-full rounded-lg object-cover ring-1 ring-line"
      />
      <span className="block truncate">{asset.title}</span>
    </button>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-3 first:mt-1">
      <p className="mb-2 flex justify-between text-[12px] font-medium text-ink-2">
        <span>{title}</span>
        <span className="text-ink-3">{count}</span>
      </p>
      {children}
    </section>
  );
}
