'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { Analysis, AnalysisCut } from '@/lib/analyze';
import { AnalysisChips, AnalysisState, clock, CutTile, fileOf, lengthLabel, useAnalyses } from './Analyze';
import { Lightbox, type LightboxItem } from './Lightbox';

/** 소리 그래프의 바닥과 꼭대기(LUFS) */
const QUIET = -60;
const LOUD = -5;
const PAGE_SECONDS = 120;

const level = (lufs: number | null) => (lufs === null ? 0 : (Math.min(LOUD, Math.max(QUIET, lufs)) - QUIET) / (LOUD - QUIET));
const cutAt = (cuts: AnalysisCut[], t: number) => cuts.reduce((found, cut) => (cut.start <= t ? cut : found), cuts[0]);

/** 시간 흐름: 1초마다 소리 크기(면)와 컷이 바뀐 자리(아래 눈금). 눈금이 촘촘하면 컷이 빠르다 */
function FlowChart({ analysis }: { analysis: Analysis }) {
  const [hover, setHover] = useState<number | null>(null);
  const { duration, cuts } = analysis;
  const sound = analysis.sound ?? [];
  const n = Math.max(1, sound.length);
  const points = sound.map((v, i) => `L${i + 0.5} ${(100 - level(v) * 100).toFixed(1)}`).join(' ');
  const step = duration > 1200 ? 300 : duration > 600 ? 120 : 60;
  const ticks = Array.from({ length: Math.ceil(duration / step) }, (_, i) => i * step);
  const heard = sound.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
  const loudest = heard.reduce<{ v: number; i: number } | null>((best, x) => (!best || x.v > best.v ? x : best), null);
  const quietest = heard.reduce<{ v: number; i: number } | null>((best, x) => (!best || x.v < best.v ? x : best), null);
  const hovered = hover === null ? null : cutAt(cuts, hover);
  const hoverSound = hover === null ? null : (sound[Math.floor(hover)] ?? null);

  const timeOf = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * duration;
  };

  return (
    <figure className="floating mb-6 p-4" aria-label="소리 크기와 컷 흐름">
      <figcaption className="mb-3 text-[13px] leading-[1.5]">
        <span className="font-semibold text-ink">흐름</span>
        <span className="ml-2 text-ink-2">면은 1초마다 소리 크기, 아래 눈금은 컷이 바뀐 자리예요. 눈금이 촘촘할수록 컷이 빨라요. 누르면 그 컷으로 가요.</span>
      </figcaption>
      <div
        role="img"
        aria-label={`${lengthLabel(duration)} 동안 ${cuts.length}컷.${loudest ? ` 소리가 가장 큰 곳 ${clock(loudest.i)}.` : ''}${quietest ? ` 가장 조용한 곳 ${clock(quietest.i)}.` : ''}`}
        className="relative cursor-crosshair select-none"
        onPointerMove={(e) => setHover(timeOf(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const cut = cutAt(cuts, timeOf(e));
          document.querySelector(`[data-cut="${cut.no}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
      >
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="block h-[110px] w-full" aria-hidden="true">
          <line x1="0" x2={n} y1="100" y2="100" stroke="var(--color-line-strong)" vectorEffect="non-scaling-stroke" />
          <path d={`M0 100 L0 ${(100 - level(sound[0] ?? null) * 100).toFixed(1)} ${points} L${n} 100 Z`} fill="var(--color-brand-soft)" />
          <path d={`M0 ${(100 - level(sound[0] ?? null) * 100).toFixed(1)} ${points}`} fill="none" stroke="var(--color-brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="relative mt-1 h-[14px]" aria-hidden="true">
          {cuts.slice(1).map((cut) => (
            <i key={cut.no} className="absolute bottom-0 top-0 w-px bg-ink-3" style={{ left: `${(cut.start / duration) * 100}%` }} />
          ))}
        </div>
        {hover !== null && hovered ? (
          <>
            <i className="pointer-events-none absolute bottom-0 top-0 w-px bg-ink" style={{ left: `${(hover / duration) * 100}%` }} aria-hidden="true" />
            <span
              className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] tabular-nums text-ink"
              style={{ left: `${(hover / duration) * 100}%`, transform: `translateX(${hover / duration > 0.6 ? 'calc(-100% - 8px)' : '8px'})` }}
            >
              {clock(hover)} · {hovered.no}번 컷 {hovered.seconds.toFixed(1)}초 · 소리 {hoverSound === null ? '조용' : `${hoverSound} LUFS`}
            </span>
          </>
        ) : null}
      </div>
      <div className="relative mt-1.5 h-[30px] text-[11px] tabular-nums text-ink-3" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="absolute top-0 whitespace-nowrap" style={{ left: `${(t / duration) * 100}%`, transform: t === 0 ? undefined : 'translateX(-50%)' }}>
            {(t / duration) * 100 < 96 ? (
              <>
                <span className="block">{clock(t)}</span>
                <span className="block text-ink-4">{cuts.filter((c) => c.start >= t && c.start < t + step).length}컷</span>
              </>
            ) : null}
          </span>
        ))}
      </div>
    </figure>
  );
}

function ExtraTile({ analysisId, cut, at, frame, onOpen }: { analysisId: string; cut: AnalysisCut; at: number; frame: string; onOpen: (item: LightboxItem) => void }) {
  const offset = Math.round(at - cut.start);
  return (
    <figure className="min-w-0">
      <button
        type="button"
        aria-label={`${cut.no}번 컷 ${offset}초 뒤 크게 보기`}
        onClick={() => onOpen({ url: fileOf(analysisId, frame), kind: 'image', title: `${cut.no}번 컷 +${offset}초`, meta: clock(at) })}
        className="relative block w-full overflow-hidden rounded-lg bg-fill opacity-75 ring-1 ring-line transition hover:opacity-100 hover:ring-line-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileOf(analysisId, frame)} alt="" loading="lazy" className="block w-full" />
        <span className="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] font-bold text-brand-dark">+{offset}초</span>
      </button>
      <figcaption className="mt-1 text-[11.5px] tabular-nums text-ink-3">
        {clock(at)} · {cut.no}번 컷 안
      </figcaption>
    </figure>
  );
}

function VideoResult({ analysis, onOpen }: { analysis: Analysis; onOpen: (item: LightboxItem) => void }) {
  const { cuts, duration } = analysis;
  const lengths = cuts.map((c) => c.seconds).sort((a, b) => a - b);
  const middle = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const quick = cuts.filter((c) => c.seconds < 1).length;
  const longest = cuts.reduce((best, c) => (c.seconds > best.seconds ? c : best), cuts[0]);
  const pages =
    analysis.grids?.map(({ from, to }) => ({ from, to })) ??
    Array.from({ length: Math.ceil(duration / PAGE_SECONDS) }, (_, i) => ({ from: i * PAGE_SECONDS, to: Math.min(duration, (i + 1) * PAGE_SECONDS) }));

  return (
    <section aria-label="분석 결과">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold">{analysis.title}</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {lengthLabel(duration)} · {cuts.length}컷 · 컷 길이 가운데값 {middle.toFixed(1)}초 · 1초 미만 {quick}컷 · 가장 긴 컷 {longest.no}번 {longest.seconds.toFixed(1)}초
          </p>
        </div>
        <a href={analysis.url} target="_blank" rel="noreferrer" className="btn btn-line ml-auto">
          <ExternalLink size={14} />
          원본 보기
        </a>
      </div>
      <FlowChart analysis={analysis} />
      <p className="mb-4 text-[12.5px] text-ink-3">칸 아래 막대는 소리와 리듬으로 어림한 긴장도예요. 8초가 넘는 컷은 4초마다 안쪽 장면을 같이 보여 줘요.</p>
      {pages.map(({ from, to }) => {
        const items = [
          ...cuts.filter((c) => c.start >= from && c.start < to).map((cut) => ({ at: cut.start, cut, frame: null as string | null })),
          ...cuts.flatMap((cut) => (cut.extra ?? []).filter((x) => x.at >= from && x.at < to).map((x) => ({ at: x.at, cut, frame: x.frame as string | null }))),
        ].sort((a, b) => a.at - b.at);
        if (!items.length) return null;
        return (
          <section key={from} aria-label={`${clock(from)}부터 ${clock(to)}까지`} className="mb-7">
            <h3 className="mb-2.5 text-[14px] font-semibold tabular-nums">
              {clock(from)} – {clock(to)}
              <span className="ml-2 text-[12.5px] font-normal text-ink-3">{items.filter((x) => !x.frame).length}컷</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-4">
              {items.map((item) =>
                item.frame ? (
                  <ExtraTile key={item.frame} analysisId={analysis.id} cut={item.cut} at={item.at} frame={item.frame} onOpen={onOpen} />
                ) : (
                  <CutTile key={item.cut.frame} analysisId={analysis.id} cut={item.cut} onOpen={onOpen} />
                ),
              )}
            </div>
          </section>
        );
      })}
    </section>
  );
}

export function VideoImportView({ initial, initialOpen }: { initial: Analysis[]; initialOpen?: string }) {
  const { analyses, url, setUrl, busy, error, openId, setOpenId, submit, opened } = useAnalyses('video', initial, initialOpen);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  return (
    <>
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">영상 가져오기</h1>
      <p className="mb-5 mt-1 max-w-[860px] text-[14px] leading-[1.55] text-ink-2">
        단편 애니메이션이나 긴 광고처럼 30분 이하 영상을 처음부터 끝까지 컷으로 나눠 흐름을 봐요. 컷 리듬과 소리 크기를 보는 공부용이라 프로젝트는 만들지 않아요. 따라 만들 때는 숏츠 가져오기를 써 주세요. 크레딧이 들지 않고, 영상은 분석한 뒤 지워요.
      </p>
      <form onSubmit={(e) => void submit(e)} className="mb-7 flex max-w-[760px] gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="영상 주소" placeholder="https://www.youtube.com/watch?v=…" className="field h-10 min-w-0 flex-1 text-[14px]" />
        <button type="submit" className="btn btn-primary h-10 px-5 text-[14px]" disabled={busy || !url.trim()}>
          분석하기
        </button>
      </form>
      {error ? <p className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p> : null}
      <AnalysisChips analyses={analyses} openId={openId} onOpen={setOpenId} />
      <AnalysisState analysis={opened} />
      {opened?.status === 'done' && opened.cuts.length ? <VideoResult analysis={opened} onOpen={setLightbox} /> : null}
      {lightbox ? <Lightbox item={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  );
}
