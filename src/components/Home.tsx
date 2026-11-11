'use client';

import { ArrowUpRight, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import { formatNumber, STEPS } from '@/lib/models';
import type { BalanceInfo, CfRef, LibraryIdea, Project, ProjectSummary, ShowcaseItem } from '@/lib/types';
import { Lightbox, type LightboxItem } from './Lightbox';
import { ProjectGrid } from './ProjectGrid';
import { useCreateProject } from './Sidebar';

const MONTHLY_CREDITS = 3000;
const POSTER_HEIGHT = 150;
/** 이보다 적으면 흐르게 하지 않는다. 같은 작업이 되풀이돼 보인다 */
const MARQUEE_FROM = 6;

/** 힉스필드 크레딧은 매달 22일 오전 11시(KST)에 3,000으로 갱신된다 */
function nextRefill(now = new Date()): { label: string; days: number } {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  let year = kst.getUTCFullYear();
  let month = kst.getUTCMonth();
  if (kst.getUTCDate() > 22 || (kst.getUTCDate() === 22 && kst.getUTCHours() >= 11)) month += 1;
  if (month > 11) {
    month = 0;
    year += 1;
  }
  const refill = Date.UTC(year, month, 22, 2);
  return { label: `${month + 1}월 22일`, days: Math.max(0, Math.ceil((refill - now.getTime()) / 86400000)) };
}

function StatTile({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="group flex items-baseline justify-between gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-white/5">
      <span className="text-[13px] text-ink-2 group-hover:text-ink">{label}</span>
      <b className="text-[15px] font-semibold tabular-nums text-ink">{formatNumber(value)}</b>
    </Link>
  );
}

export function Home({
  projects,
  balance,
  showcase,
  counts,
  ideas,
  trends,
}: {
  projects: ProjectSummary[];
  balance: BalanceInfo;
  showcase: ShowcaseItem[];
  counts: { models: number; plans: number; videos: number; cf: number };
  ideas: LibraryIdea[];
  trends: CfRef[];
}) {
  const router = useRouter();
  const { create, creating } = useCreateProject();
  const [open, setOpen] = useState<LightboxItem | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const refill = nextRefill();
  const flowing = showcase.length >= MARQUEE_FROM;

  const start = async (url: string, body: Record<string, string>) => {
    setStarting(true);
    try {
      const { project } = await api<{ project: Project }>(url, { method: 'POST', body });
      router.push(`/p/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  return (
    <>
      <div className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="floating relative flex min-h-[340px] min-w-0 flex-col justify-end overflow-hidden p-5 sm:min-h-[410px] sm:p-8" aria-label="시작하기">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/home/hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover object-[right_46%]" />
          <div className="absolute inset-0 bg-[linear-gradient(0deg,#08080b_18%,rgba(8,8,11,0.5)_100%)] sm:bg-[linear-gradient(90deg,#08080b_0%,rgba(8,8,11,0.86)_34%,rgba(8,8,11,0)_68%)]" />
          <div className="relative max-w-[560px]">
            <h1 className="text-[26px] font-bold leading-[1.25] tracking-[-0.03em] sm:text-[34px]">
              장면부터 확인하고,
              <br />
              확인한 컷만 생성해요
            </h1>
            <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-2" aria-label="7단계 제작 흐름">
              {STEPS.map((step, index) => (
                <li key={step} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="text-ink-4">·</span> : null}
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={create} disabled={creating} className="btn btn-primary h-10 px-4 text-[14px] sm:h-11 sm:px-5">
                <Plus size={16} strokeWidth={2.4} />새 프로젝트
              </button>
              <Link href="/cf-refs" className="btn btn-line h-10 bg-black/40 px-4 text-[14px] backdrop-blur-sm sm:h-11 sm:px-5">
                CF에서 고르기
              </Link>
              <Link href="/analyze" className="btn btn-line h-10 bg-black/40 px-4 text-[14px] backdrop-blur-sm sm:h-11 sm:px-5">
                숏츠 가져오기
              </Link>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <section className="floating flex flex-col p-5" aria-label="힉스필드 잔액">
            <p className="text-[12.5px] text-ink-3">힉스필드 잔액</p>
            <p className="mt-1 text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums">{balance ? formatNumber(Math.floor(balance.credits)) : '—'}</p>
            <span className="tension mt-4 h-1">
              <i className="!bg-brand" style={{ width: `${Math.min(100, ((balance?.credits ?? 0) / MONTHLY_CREDITS) * 100)}%` }} />
            </span>
            <p className="mt-2.5 text-[12.5px] leading-[1.5] text-ink-2">
              {refill.label} 오전 11시에 3,000으로 갱신돼요. {refill.days}일 남았어요.
            </p>
          </section>
          <section className="floating flex flex-col justify-center gap-0.5 px-4 py-3" aria-label="모아 둔 자산">
            <StatTile label="내 모델" value={counts.models} href="/assets" />
            <StatTile label="내 기획" value={counts.plans} href="/assets" />
            <StatTile label="내 영상" value={counts.videos} href="/gallery" />
            <StatTile label="CF 레퍼런스" value={counts.cf} href="/cf-refs" />
          </section>
        </div>
      </div>

      {showcase.length ? (
        <section className="mb-9" aria-label="고른 작업">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[16px] font-semibold">고른 작업</h2>
            <Link href="/gallery" className="inline-flex items-center gap-0.5 text-[13px] text-ink-2 hover:text-ink">
              갤러리 <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className={flowing ? 'poster-band overflow-hidden' : 'thin-scroll overflow-x-auto'}>
            <div className={`gap-3 ${flowing ? 'marquee' : 'flex w-max'}`}>
              {(flowing ? [...showcase, ...showcase] : showcase).map((item, index) => (
                <button
                  key={`${item.key}-${index}`}
                  type="button"
                  aria-label={`${item.title} 보기`}
                  tabIndex={index < showcase.length ? 0 : -1}
                  title={item.title}
                  onClick={() => setOpen({ url: item.url, kind: item.kind, title: item.title, poster: item.poster || undefined, meta: item.meta, note: item.note })}
                  style={{ width: Math.round(POSTER_HEIGHT * Math.min(item.ratio, 2)), height: POSTER_HEIGHT }}
                  className="group relative flex-none overflow-hidden rounded-xl bg-fill ring-1 ring-line transition-shadow hover:ring-line-strong"
                >
                  {item.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <video src={item.url} preload="metadata" muted className="h-full w-full object-cover" />
                  )}
                  {item.kind === 'video' ? (
                    <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                      <Play size={16} fill="currentColor" className="ml-0.5" />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mb-10" aria-label="전체 프로젝트">
        <h2 className="mb-4 text-[16px] font-semibold">전체 프로젝트</h2>
        <ProjectGrid initial={projects} />
      </section>

      {error ? <p className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p> : null}

      {ideas.length || trends.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {ideas.length ? (
            <section className="floating min-w-0 p-5" aria-label="내 기획에서 시작">
              <div className="mb-3.5 flex items-baseline justify-between">
                <h2 className="text-[16px] font-semibold">내 기획에서 시작</h2>
                <Link href="/assets" className="inline-flex items-center gap-0.5 text-[13px] text-ink-2 hover:text-ink">
                  전체 <ArrowUpRight size={14} />
                </Link>
              </div>
              <ul className="grid grid-cols-1 gap-3">
                {ideas.map((idea) => (
                  <li key={idea.id} className="flex items-center gap-3">
                    {idea.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={idea.images[0].url} alt="" loading="lazy" className="h-[68px] w-[68px] flex-none rounded-lg object-cover ring-1 ring-line" />
                    ) : (
                      <span className="h-[68px] w-[68px] flex-none rounded-lg bg-inset ring-1 ring-line" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">{idea.title}</p>
                      <p className="line-clamp-2 mt-0.5 text-[12.5px] leading-[1.45] text-ink-2">{idea.logline}</p>
                    </div>
                    <button type="button" disabled={starting} className="btn btn-line h-8 flex-none px-2.5 text-[12px]" onClick={() => void start('/api/projects/from-library', { itemId: idea.id })}>
                      시작
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {trends.length ? (
            <section className="floating min-w-0 p-5" aria-label="요즘 CF">
              <div className="mb-3.5 flex items-baseline justify-between">
                <h2 className="text-[16px] font-semibold">요즘 통하는 CF</h2>
                <Link href="/cf-refs" className="inline-flex items-center gap-0.5 text-[13px] text-ink-2 hover:text-ink">
                  전체 <ArrowUpRight size={14} />
                </Link>
              </div>
              <ul className="grid grid-cols-1 gap-3">
                {trends.map((item) => (
                  <li key={item.refId} className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.thumbUrl} alt="" loading="lazy" className="h-[68px] w-[88px] flex-none rounded-lg object-cover ring-1 ring-line sm:w-[120px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">{item.titleKo || item.title}</p>
                      <p className="line-clamp-2 mt-0.5 text-[12.5px] leading-[1.45] text-ink-2">{item.trend}</p>
                    </div>
                    <button type="button" disabled={starting} className="btn btn-line h-8 flex-none px-2.5 text-[12px]" title="구조와 기법만 시나리오로 옮겨요" onClick={() => void start('/api/projects/from-cf', { refId: item.refId })}>
                      시작
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {open ? <Lightbox item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
