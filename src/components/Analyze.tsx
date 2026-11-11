'use client';

import { ExternalLink, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Analysis, AnalysisCut } from '@/lib/analyze';
import { api, formatDateTime } from '@/lib/client';
import { FOLLOW_LEVELS } from '@/lib/models';
import type { FollowLevel, Project } from '@/lib/types';
import { Lightbox, type LightboxItem } from './Lightbox';

const POLL_MS = 2000;

const fileOf = (id: string, name: string) => `/api/analyses/${id}/files/${name}`;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function CutTile({ analysisId, cut, onOpen }: { analysisId: string; cut: AnalysisCut; onOpen: (item: LightboxItem) => void }) {
  return (
    <figure className="min-w-0" data-cut={cut.no}>
      <button
        type="button"
        aria-label={`${cut.no}번 컷 크게 보기`}
        onClick={() => onOpen({ url: fileOf(analysisId, cut.frame), kind: 'image', title: `${cut.no}번 컷`, meta: `${clock(cut.start)} · ${cut.seconds.toFixed(1)}초`, note: cut.speech })}
        className="relative block w-full overflow-hidden rounded-lg bg-fill ring-1 ring-line transition-shadow hover:ring-line-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileOf(analysisId, cut.frame)} alt="" loading="lazy" className="block w-full" />
        <span className="absolute left-1 top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded bg-black/75 px-1 text-[10px] font-bold text-white">{cut.no}</span>
      </button>
      <figcaption className="mt-1 text-[11.5px] text-ink-3">
        <span className="flex justify-between gap-1 tabular-nums">
          <span>{clock(cut.start)}</span>
          <span className="text-ink-2">{cut.seconds.toFixed(1)}초</span>
        </span>
        <span className="tension mt-1">
          <i style={{ width: `${cut.tension}%` }} />
        </span>
        {cut.speech ? <span className="line-clamp-3 mt-1 text-[11px] leading-[1.4] text-ink-3">{cut.speech}</span> : null}
      </figcaption>
    </figure>
  );
}

export function AnalyzeView({ initial, initialOpen }: { initial: Analysis[]; initialOpen?: string }) {
  const router = useRouter();
  const [analyses, setAnalyses] = useState(initial);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialOpen ?? initial[0]?.id ?? null);
  const [level, setLevel] = useState<FollowLevel>('structure');
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const running = analyses.some((a) => a.status === 'running');

  const refresh = useCallback(async () => {
    const res = await api<{ analyses: Analysis[] }>('/api/analyses');
    setAnalyses(res.analyses);
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, running]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { analysis } = await api<{ analysis: Analysis }>('/api/analyses', { method: 'POST', body: { url } });
      setAnalyses((list) => [analysis, ...list]);
      setOpenId(analysis.id);
      setUrl('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const makeProject = async (id: string) => {
    setBusy(true);
    try {
      const { project } = await api<{ project: Project }>(`/api/analyses/${id}/project`, { method: 'POST', body: { level } });
      router.push(`/p/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const opened = analyses.find((a) => a.id === openId);

  return (
    <>
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">숏츠 가져오기</h1>
      <p className="mb-5 mt-1 max-w-[860px] text-[14px] leading-[1.55] text-ink-2">
        유튜브 주소를 넣으면 컷 시간과 리듬, 소리 크기를 뽑아 샷 표로 바꿔요. 크레딧이 들지 않아요. 영상은 분석한 뒤 지워요. 어느 정도로 따라 만들지 고를 수 있고, 어느 단계든 남의 화면 자체는 프로젝트로 넘어가지 않아요.
      </p>
      <form onSubmit={(e) => void submit(e)} className="mb-7 flex max-w-[760px] gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="영상 주소"
          placeholder="https://www.youtube.com/shorts/…"
          className="field h-10 min-w-0 flex-1 text-[14px]"
        />
        <button type="submit" className="btn btn-primary h-10 px-5 text-[14px]" disabled={busy || !url.trim()}>
          분석하기
        </button>
      </form>
      {error ? <p className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p> : null}

      {analyses.length ? (
        <div className="mb-7 flex flex-wrap gap-2" role="group" aria-label="분석한 영상">
          {analyses.map((analysis) => (
            <button
              key={analysis.id}
              type="button"
              aria-pressed={openId === analysis.id}
              onClick={() => setOpenId(analysis.id)}
              className={`flex max-w-[320px] items-center gap-2 rounded-xl border p-1.5 pr-3 text-left transition-colors ${
                openId === analysis.id ? 'border-transparent bg-brand-soft' : 'border-line hover:border-line-strong'
              }`}
            >
              {analysis.cuts[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileOf(analysis.id, analysis.cuts[0].frame)} alt="" className="h-10 w-10 flex-none rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-fill text-ink-3">
                  {analysis.status === 'running' ? <LoaderCircle size={16} className="spin" /> : null}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink">{analysis.title || analysis.url}</span>
                <span className="block truncate text-[11.5px] text-ink-3">
                  {analysis.status === 'running' ? analysis.step : analysis.status === 'failed' ? '실패' : `${analysis.cuts.length}컷 · ${Math.round(analysis.duration)}초`}
                  {' · '}
                  {formatDateTime(analysis.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {opened?.status === 'running' ? (
        <p className="flex items-center gap-2 text-[14px] text-ink-2">
          <LoaderCircle size={16} className="spin" />
          {opened.step}. 영상 길이에 따라 몇 분 걸릴 수 있어요.
        </p>
      ) : null}

      {opened?.status === 'failed' ? (
        <div className="rounded-xl bg-bad-soft px-4 py-3 text-[13px] leading-[1.55]">
          <p className="font-semibold text-bad">분석하지 못했어요</p>
          <p className="mt-0.5 break-words text-ink-2">{opened.error}</p>
        </div>
      ) : null}

      {opened?.status === 'done' ? (
        <section aria-label="분석 결과">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold">{opened.title}</h2>
              <p className="mt-0.5 text-[13px] text-ink-2">
                {Math.round(opened.duration)}초 · {opened.cuts.length}컷 · 컷 평균 {(opened.duration / opened.cuts.length).toFixed(1)}초 · 막대는 소리와 리듬으로 어림한 긴장도예요
              </p>
            </div>
            <a href={opened.url} target="_blank" rel="noreferrer" className="btn btn-line ml-auto">
              <ExternalLink size={14} />
              원본 보기
            </a>
          </div>
          <div className="floating mb-5 max-w-[860px] p-4">
            <p className="mb-2 text-[13px] font-semibold">어느 정도로 따라 만들까요?</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="따라 만드는 정도">
              {FOLLOW_LEVELS.map((item) => (
                <button key={item.value} type="button" className="chip h-8" aria-pressed={level === item.value} onClick={() => setLevel(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[12.5px] leading-[1.55] text-ink-2">
              가져오는 것: {FOLLOW_LEVELS.find((item) => item.value === level)?.takes}. {FOLLOW_LEVELS.find((item) => item.value === level)?.fresh}
              {level === 'rhythm' ? '' : ' 프로젝트를 만든 뒤 대화에서 “샷 채워줘”라고 하면 Claude가 이 컷들을 읽고 샷 표를 써요.'}
            </p>
            <button type="button" className="btn btn-primary mt-3" disabled={busy} onClick={() => void makeProject(opened.id)}>
              이 정도로 프로젝트 만들기
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-4">
            {opened.cuts.map((cut) => (
              <CutTile key={cut.no} analysisId={opened.id} cut={cut} onOpen={setLightbox} />
            ))}
          </div>
        </section>
      ) : null}

      {lightbox ? <Lightbox item={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  );
}
