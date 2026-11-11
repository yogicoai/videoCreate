'use client';

import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';
import type { CfConcept, CfLibrary, CfRef, Project } from '@/lib/types';
import { Lightbox, type LightboxItem } from './Lightbox';

const COUNTRY: Record<string, string> = {
  KR: '한국', JP: '일본', US: '미국', GB: '영국', CA: '캐나다', FR: '프랑스', AU: '호주', SE: '스웨덴', TH: '태국', AE: '아랍에미리트', CH: '스위스',
  IN: '인도', SG: '싱가포르', NL: '네덜란드', ES: '스페인', DE: '독일', BR: '브라질', BE: '벨기에', TR: '튀르키예', IL: '이스라엘', CN: '중국', MY: '말레이시아', DK: '덴마크',
};
const MAIN = ['KR', 'JP', 'US', 'GB'];
const PAGE = 48;

/** 조사 자료의 주소는 http(s) 만 링크로 쓴다 */
const safeUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : '');

function FitDots({ n }: { n: number }) {
  return (
    <span className="inline-flex flex-none items-center gap-[3px]" title={`요기보 적합도 ${n} / 5`} aria-label={`적합도 ${n}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={`h-[7px] w-[7px] rounded-full ${i <= n ? 'bg-brand' : 'bg-fill ring-1 ring-line'}`} />
      ))}
    </span>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-[11.5px] font-semibold text-ink-3">{title}</p>
      <div className="text-[12.5px] leading-[1.55] text-ink-2">{children}</div>
    </div>
  );
}

function RefCard({ item, onStart, onFollow, busy }: { item: CfRef; onStart: () => void; onFollow: () => void; busy: boolean }) {
  const url = safeUrl(item.url);
  const meta = [item.brand, item.year, item.country ? COUNTRY[item.country] ?? item.country : '', item.format, item.lengthSec ? `${item.lengthSec}초` : ''].filter(Boolean).join(' · ');
  const tone = item.tone ?? {};
  const toneText = [(tone.mood ?? []).join(', '), tone.music, tone.pace, tone.color].filter(Boolean).join(' · ');
  const thumb = item.thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.thumbUrl} alt="" loading="lazy" className="aspect-video w-full bg-fill object-cover" />
  ) : (
    <span className="flex aspect-video w-full items-center justify-center bg-fill text-[12px] text-ink-3">썸네일 없음</span>
  );
  return (
    <article className="floating flex min-w-0 flex-col overflow-hidden">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label={`영상 보기: ${item.title}`}>
          {thumb}
        </a>
      ) : (
        thumb
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-[11.5px] text-ink-3">{meta}</span>
          <FitDots n={item.fit} />
        </div>
        <h3 className="text-[14px] font-semibold leading-[1.35] [overflow-wrap:anywhere]">{item.title}</h3>
        {item.titleKo && item.titleKo !== item.title ? <p className="-mt-1 text-[12px] text-ink-3">{item.titleKo}</p> : null}
        {item.concept ? <p className="line-clamp-3 text-[12.5px] leading-[1.55] text-ink-2">{item.concept}</p> : null}
        {item.adapt ? (
          <div className="rounded-[10px] bg-brand-soft p-2.5 text-[12.5px] leading-[1.55] text-ink">
            <p className="mb-0.5 text-[11px] font-semibold text-brand-dark">요기보로 푼다면</p>
            {item.adapt}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {item.trend ? <span className="chip border-transparent bg-[rgba(192,38,211,0.16)] text-ink">요즘 트렌드</span> : null}
          {!item.checked ? <span className="chip border-transparent bg-wait-soft text-wait">링크 미확인</span> : null}
        </div>
        <details className="text-[12px] text-ink-3">
          <summary className="cursor-pointer hover:text-ink">자세히</summary>
          <div className="flex flex-col gap-2 pt-2">
            {item.why ? <Part title="왜 요기보에 맞는지">{item.why}</Part> : null}
            {item.trend ? <Part title="요즘 통하는 이유">{item.trend}</Part> : null}
            {item.hook ? <Part title="첫 3초">{item.hook}</Part> : null}
            {item.scenes?.length ? (
              <Part title={`장면 (근거: ${item.basis ?? ''})`}>
                <ul className="list-disc pl-4">
                  {item.scenes.map((scene) => (
                    <li key={scene}>{scene}</li>
                  ))}
                </ul>
              </Part>
            ) : null}
            {item.frames ? <Part title="썸네일에서 본 것">{item.frames}</Part> : null}
            {toneText ? <Part title="분위기">{toneText}</Part> : null}
            {item.technique?.length ? <Part title="기법">{item.technique.join(', ')}</Part> : null}
            {item.make || item.makeNote ? <Part title="만드는 방식">{[item.make, item.makeNote].filter(Boolean).join(' · ')}</Part> : null}
            {item.products?.length ? <Part title="어울리는 제품">{item.products.join(', ')}</Part> : null}
            {item.evidence?.length ? (
              <Part title="성과 근거">
                <ul className="list-disc pl-4">
                  {item.evidence.map((e) => (
                    <li key={e.claim}>{safeUrl(e.url) ? <a href={safeUrl(e.url)} target="_blank" rel="noreferrer" className="text-brand-dark hover:underline">{e.claim}</a> : e.claim}</li>
                  ))}
                </ul>
              </Part>
            ) : null}
            {item.sources?.length ? (
              <Part title="출처">
                <ul className="list-disc pl-4">
                  {item.sources.map((s) => (
                    <li key={`${s.url}${s.title}`} className="[overflow-wrap:anywhere]">
                      {safeUrl(s.url) ? <a href={safeUrl(s.url)} target="_blank" rel="noreferrer" className="text-brand-dark hover:underline">{s.title || s.url}</a> : s.title}
                    </li>
                  ))}
                </ul>
              </Part>
            ) : null}
            <Part title="주제">{item.themes.join(', ')}</Part>
            {url ? (
              <button type="button" disabled={busy} onClick={onStart} className="self-start text-[12px] text-brand-dark hover:underline" title="분석 없이 구조와 기법만 시나리오로 옮겨요">
                분석 없이 글로만 시작
              </button>
            ) : null}
          </div>
        </details>
        <div className="mt-auto flex items-center gap-2 pt-1">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="btn btn-line h-8 flex-1 px-2 text-[12px]">
              <ExternalLink size={13} />
              영상 보기
            </a>
          ) : (
            <span className="flex-1 text-[12px] text-ink-3">영상 주소 없음</span>
          )}
          {url ? (
            <button type="button" disabled={busy} onClick={onFollow} className="btn btn-primary h-8 flex-1 px-2 text-[12px]" title="영상을 분석해 컷과 리듬을 뽑고, 어느 정도로 따라 만들지 골라요. 크레딧이 들지 않아요">
              따라 만들기
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={onStart} className="btn btn-primary h-8 flex-1 px-2 text-[12px]" title="구조와 기법만 시나리오로 옮겨요. 원작의 사람·화면·문구는 가져오지 않아요">
              글로 시작
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ConceptSection({ concept, source, onOpen }: { concept: CfConcept; source?: CfRef; onOpen: (item: LightboxItem) => void }) {
  const sourceUrl = safeUrl(source?.url);
  return (
    <section className="floating flex min-w-0 flex-col gap-5 p-5 lg:flex-row" aria-label={concept.name}>
      <div className="flex min-w-0 flex-col gap-3 lg:w-[280px] lg:flex-none">
        <div>
          <h2 className="text-[17px] font-semibold">{concept.name}</h2>
          <p className="mt-0.5 text-[12px] text-ink-3">{concept.cast}</p>
        </div>
        <p className="text-[13px] leading-[1.6] text-ink-2">{concept.plan}</p>
        {source ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11.5px] font-semibold text-ink-3">참고한 원작</p>
            {source.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={source.thumbUrl} alt="" loading="lazy" className="aspect-video w-full rounded-lg bg-fill object-cover" />
            ) : null}
            <p className="text-[12px] text-ink-3">{[source.brand, source.year].filter(Boolean).join(' · ')}</p>
            <p className="text-[12px] leading-[1.5] text-ink-2">{source.titleKo || source.title}</p>
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-[12px] text-brand-dark hover:underline">
                원작 영상 보기
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
        {concept.scenes.map((scene, index) => (
          <figure key={scene.url} className="flex min-w-0 flex-col gap-1.5">
            <button
              type="button"
              aria-label={`${concept.name} 장면 ${index + 1} 크게 보기`}
              onClick={() => onOpen({ url: scene.url, kind: 'image', title: `${concept.name} ${index + 1}`, note: scene.text })}
              className="block overflow-hidden rounded-xl ring-1 ring-line transition-all duration-200 hover:-translate-y-0.5 hover:ring-line-strong"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={scene.url} alt={scene.text} loading="lazy" className="aspect-[9/16] w-full bg-fill object-cover" />
            </button>
            <figcaption className="text-[12px] leading-[1.5] text-ink-2">
              <b className="font-semibold text-ink">{index + 1}.</b> {scene.text}
              {scene.note ? <span className="mt-0.5 block text-wait">{scene.note}</span> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export function CfRefsView() {
  const router = useRouter();
  const [library, setLibrary] = useState<CfLibrary | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'refs' | 'concepts'>('refs');
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('');
  const [fit, setFit] = useState(5);
  const [make, setMake] = useState('');
  const [country, setCountry] = useState('');
  const [onlyLink, setOnlyLink] = useState(false);
  const [onlyTrend, setOnlyTrend] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<LightboxItem | null>(null);

  useEffect(() => {
    let alive = true;
    api<CfLibrary>('/api/cf-refs')
      .then((res) => {
        if (alive) setLibrary(res);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refs = useMemo(() => library?.refs ?? [], [library]);
  const themes = useMemo(() => [...new Set(refs.flatMap((r) => r.themes))], [refs]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return refs
      .filter((r) => {
        if (r.fit < fit) return false;
        if (theme && !r.themes.includes(theme)) return false;
        if (make && r.make !== make) return false;
        if (country === 'etc' ? MAIN.includes(r.country ?? '') : country && r.country !== country) return false;
        if (onlyLink && !r.checked) return false;
        if (onlyTrend && !r.trend) return false;
        if (needle && ![r.brand, r.title, r.titleKo, r.concept, r.adapt, r.why, ...(r.technique ?? [])].join(' ').toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => b.fit - a.fit || (b.year ?? 0) - (a.year ?? 0));
  }, [country, fit, make, onlyLink, onlyTrend, query, refs, theme]);

  const start = async (refId: string) => {
    setBusy(true);
    try {
      const { project } = await api<{ project: Project }>('/api/projects/from-cf', { method: 'POST', body: { refId } });
      router.push(`/p/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const follow = async (url: string) => {
    setBusy(true);
    try {
      const { analysis } = await api<{ analysis: { id: string } }>('/api/analyses', { method: 'POST', body: { url } });
      router.push(`/analyze?open=${analysis.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const trendCount = refs.filter((r) => r.trend).length;
  const concepts = library?.concepts ?? [];
  const resetLimit = () => setLimit(PAGE);

  return (
    <>
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">CF 레퍼런스</h1>
      <p className="mb-5 mt-1 max-w-[860px] text-[14px] leading-[1.55] text-ink-2">
        영상을 기획할 때 찾아보는 국내외 CF {refs.length}편이고, 그중 {trendCount}편은 트렌드 영상이에요.
        영상을 직접 본 것이 아니라 설명글, 기사, 수상 사례, 썸네일로 정리한 자료라 기획에 쓰기 전에 영상을 직접 확인해 주세요. 「요기보로 푼다면」은 베끼는 안이 아니라 출발점이에요.
      </p>

      <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="보기">
        <button type="button" className="chip h-8" aria-pressed={tab === 'refs'} onClick={() => setTab('refs')}>
          레퍼런스 <span className="text-ink-3">{refs.length}</span>
        </button>
        <button type="button" className="chip h-8" aria-pressed={tab === 'concepts'} onClick={() => setTab('concepts')}>
          예상 장면 <span className="text-ink-3">{concepts.length}</span>
        </button>
      </div>

      {error ? <p className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p> : null}
      {!library && !error ? <p className="text-[14px] text-ink-3">불러오고 있어요.</p> : null}
      {library && !refs.length ? <p className="rounded-2xl border border-line bg-fill-2 px-5 py-10 text-center text-[14px] text-ink-2">아직 가져온 레퍼런스가 없어요.</p> : null}

      {tab === 'refs' && refs.length ? (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px]">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetLimit();
              }}
              placeholder="브랜드, 제목, 내용으로 찾기"
              aria-label="찾기"
              className="field h-9 w-full min-w-0 flex-1 sm:min-w-[220px]"
            />
            <select aria-label="주제" className="field h-9 max-w-[240px]" value={theme} onChange={(e) => { setTheme(e.target.value); resetLimit(); }}>
              <option value="">주제 전체</option>
              {themes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select aria-label="요기보 적합도" className="field h-9" value={fit} onChange={(e) => { setFit(Number(e.target.value)); resetLimit(); }}>
              <option value={0}>적합도 전체</option>
              <option value={5}>적합도 5</option>
              <option value={4}>적합도 4 이상</option>
              <option value={3}>적합도 3 이상</option>
            </select>
            <select aria-label="만드는 방식" className="field h-9" value={make} onChange={(e) => { setMake(e.target.value); resetLimit(); }}>
              <option value="">만드는 방식 전체</option>
              <option>실사</option>
              <option>혼합</option>
              <option>AI 생성</option>
            </select>
            <select aria-label="나라" className="field h-9" value={country} onChange={(e) => { setCountry(e.target.value); resetLimit(); }}>
              <option value="">나라 전체</option>
              <option value="KR">한국</option>
              <option value="JP">일본</option>
              <option value="US">미국</option>
              <option value="GB">영국</option>
              <option value="etc">그 외</option>
            </select>
            <label className="inline-flex items-center gap-1.5 text-ink-2">
              <input type="checkbox" checked={onlyLink} onChange={(e) => { setOnlyLink(e.target.checked); resetLimit(); }} /> 링크 확인된 것만
            </label>
            <label className="inline-flex items-center gap-1.5 text-ink-2">
              <input type="checkbox" checked={onlyTrend} onChange={(e) => { setOnlyTrend(e.target.checked); resetLimit(); }} /> 요즘 트렌드만
            </label>
            <span className="tabular-nums text-ink-3">{rows.length}편</span>
          </div>
          {rows.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] items-start gap-4">
              {rows.slice(0, limit).map((item) => (
                <RefCard key={item.refId} item={item} busy={busy} onStart={() => void start(item.refId)} onFollow={() => void follow(safeUrl(item.url))} />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-line bg-fill-2 px-5 py-8 text-center text-[13px] text-ink-2">조건에 맞는 레퍼런스가 없어요. 적합도나 주제 조건을 넓혀 보세요.</p>
          )}
          {rows.length > limit ? (
            <div className="mt-6 flex justify-center">
              <button type="button" className="btn btn-line h-10 px-6" onClick={() => setLimit((v) => v + PAGE)}>
                더 보기 ({rows.length - limit}편 남음)
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'concepts' && library ? (
        <>
          <p className="mb-4 max-w-[860px] text-[13px] leading-[1.55] text-ink-2">
            마음에 든 CF를 요기보로 풀면 어떤 그림이 될지 장면만 먼저 뽑아 본 것이에요. 영상이 아니라 그림이고, 아직 문구는 넣지 않았어요. 그림을 누르면 크게 열립니다.
          </p>
          <div className="flex flex-col gap-5">
            {concepts.map((concept) => (
              <ConceptSection key={concept.refId} concept={concept} source={refs.find((r) => r.refId === concept.refId)} onOpen={setOpen} />
            ))}
          </div>
        </>
      ) : null}

      {open ? <Lightbox item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
