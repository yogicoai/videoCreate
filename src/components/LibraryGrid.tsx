'use client';

import { Plus, Upload, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, pickFiles } from '@/lib/client';
import { ASSET_TYPE_LABEL, LIKENESS_LEVELS } from '@/lib/models';
import type {
  AssetType,
  AssetView,
  LibraryBoard,
  LibraryIdea,
  LibraryModel,
  LibraryRule,
  LibraryView,
  LibraryWork,
  Project,
  RuleSet,
} from '@/lib/types';
import { Lightbox, type LightboxItem } from './Lightbox';

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-6';

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.value} type="button" className="chip h-8" aria-pressed={value === tab.value} onClick={() => onChange(tab.value)}>
          {tab.label}
          {tab.count !== undefined ? <span className="text-ink-3">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-line bg-fill-2 px-5 py-10 text-center text-[14px] text-ink-2">{text}</p>;
}

function useStartFrom() {
  const router = useRouter();
  const [error, setError] = useState('');
  const start = async (itemId: string) => {
    try {
      const { project } = await api<{ project: Project }>('/api/projects/from-library', { method: 'POST', body: { itemId } });
      router.push(`/p/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { start, error };
}

// ─── 자산 ─────────────────────────────────────────────────

type AssetTab = 'character' | 'background' | 'rule' | 'plan';

export function AssetsView({ library }: { library: LibraryView }) {
  const [tab, setTab] = useState<AssetTab>('character');
  const [open, setOpen] = useState<LightboxItem | null>(null);

  const people = library.images.filter((a) => a.type === 'character' || a.type === 'product' || a.type === 'other');
  const backgrounds = library.images.filter((a) => a.type === 'background');
  const planCount = library.ideas.length + library.boards.length + library.works.length;

  return (
    <>
      <div className="mb-5">
        <Tabs<AssetTab>
          label="자산 종류"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'character', label: '모델', count: library.models.length + people.length },
            { value: 'background', label: '배경', count: backgrounds.length },
            { value: 'rule', label: '제작 규칙', count: library.rules.length },
            { value: 'plan', label: '내 기획', count: planCount },
          ]}
        />
      </div>
      {tab === 'character' ? <CharacterTab models={library.models} images={people} onOpen={setOpen} /> : null}
      {tab === 'background' ? <ImageTab images={backgrounds} defaultType="background" onOpen={setOpen} empty="아직 배경 시트가 없어요. 와이드 컷 사진을 올리거나, 캔버스에서 뽑은 배경 시트를 자산으로 저장하면 여기에 모여요." /> : null}
      {tab === 'rule' ? <RuleTab rules={library.rules} /> : null}
      {tab === 'plan' ? <PlanTab ideas={library.ideas} boards={library.boards} works={library.works} onOpen={setOpen} /> : null}
      {open ? <Lightbox item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function CharacterTab({ models, images, onOpen }: { models: LibraryModel[]; images: AssetView[]; onOpen: (item: LightboxItem) => void }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">내 모델</h2>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <UserPlus size={15} />새 모델 만들기
        </button>
      </div>
      {creating ? <ModelForm onClose={() => setCreating(false)} /> : null}
      {models.length ? (
        <div className={GRID}>
          {models.map((model) => (
            <figure key={model.id} className="min-w-0">
              <button
                type="button"
                aria-label={`${model.title} 크게 보기`}
                onClick={() => onOpen({ url: model.rep, kind: 'image', title: model.title, meta: model.size, note: model.identity })}
                className="block aspect-[3/4] w-full overflow-hidden rounded-xl bg-fill ring-1 ring-line transition-all duration-200 hover:-translate-y-0.5 hover:ring-line-strong"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={model.rep} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
              <figcaption className="mt-2">
                <p className="truncate text-[13px] font-medium text-ink">{model.title}</p>
                <p className="line-clamp-3 text-[12px] leading-[1.45] text-ink-3">{model.identity}</p>
                <SheetLinks model={model} onOpen={onOpen} />
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <Empty text="아직 모델이 없어요. 새 모델을 만들어 보세요." />
      )}
      <h2 className="mb-3 mt-9 text-[15px] font-semibold">캐릭터 시트</h2>
      <ImageTab images={images} defaultType="character" onOpen={onOpen} empty="아직 올린 시트가 없어요. 캔버스에서 뽑은 캐릭터 시트를 자산으로 저장하면 여기에 모여요." />
    </>
  );
}

function SheetLinks({ model, onOpen }: { model: LibraryModel; onOpen: (item: LightboxItem) => void }) {
  const items = [
    { key: 'face' as const, label: '얼굴' },
    { key: 'expr' as const, label: '표정' },
    { key: 'body' as const, label: '몸' },
  ].filter((s) => model.sheets[s.key]);
  if (!items.length) return null;
  return (
    <p className="mt-1 flex gap-2 text-[12px]">
      {items.map((sheet) => (
        <button
          key={sheet.key}
          type="button"
          className="text-brand-dark hover:underline"
          onClick={() => onOpen({ url: model.sheets[sheet.key] as string, kind: 'image', title: `${model.title} ${sheet.label} 시트` })}
        >
          {sheet.label}
        </button>
      ))}
    </p>
  );
}

function ModelForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('여성');
  const [identity, setIdentity] = useState('');
  const [size, setSize] = useState('');
  const [refs, setRefs] = useState<File[]>([]);
  const [likeness, setLikeness] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refUrls = useMemo(() => refs.map((file) => URL.createObjectURL(file)), [refs]);
  useEffect(() => () => refUrls.forEach((url) => URL.revokeObjectURL(url)), [refUrls]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const form = new FormData();
      form.append('title', title);
      form.append('category', category);
      form.append('identity', identity);
      form.append('size', size);
      form.append('likeness', String(likeness));
      for (const file of refs) form.append('refs', file);
      const { project } = await api<{ project: Project }>('/api/projects/model-draft', { method: 'POST', body: form });
      router.push(`/p/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="floating mb-5 grid max-w-[720px] gap-3 p-4">
      <p className="text-[13px] leading-[1.55] text-ink-2">
        앞·뒤·옆과 표정까지 한 장에 뽑고, 앱이 칸별로 잘라 대표컷·얼굴·표정·몸으로 나눠요. 프로젝트가 만들어지기만 하고 생성은 눌러야 시작돼요. 힉스필드 4K 1장, 4크레딧이에요.
      </p>
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="grid gap-1 text-[12px] text-ink-3">
          이름
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="여성 H" className="field h-9" />
        </label>
        <label className="grid gap-1 text-[12px] text-ink-3">
          구분
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="field h-9">
            <option>여성</option>
            <option>남성</option>
            <option>아동</option>
          </select>
        </label>
      </div>
      <div className="grid gap-1.5 text-[12px] text-ink-3">
        <span>참고 사진. 원하는 느낌의 사람 사진을 3장까지 넣을 수 있어요</span>
        <div className="flex flex-wrap items-center gap-2">
          {refs.map((file, index) => (
            <span key={`${file.name}${index}`} className="relative h-[72px] w-[56px] flex-none overflow-hidden rounded-lg ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={refUrls[index]} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`${index + 1}번 참고 사진 빼기`}
                onClick={() => setRefs((list) => list.filter((_, i) => i !== index))}
                className="absolute right-0.5 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/70 text-[11px] text-white"
              >
                ×
              </button>
            </span>
          ))}
          {refs.length < 3 ? (
            <button type="button" className="btn btn-line h-9" onClick={() => pickFiles(true, (files) => setRefs((list) => [...list, ...files].slice(0, 3)))}>
              <Upload size={14} />
              사진 넣기
            </button>
          ) : null}
        </div>
        {refs.length ? (
          <div className="mt-1 grid gap-1.5">
            <span>참고 사진과 닮은 정도</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label="닮은 정도">
              {LIKENESS_LEVELS.map((level) => (
                <button key={level.value} type="button" className="chip h-8" aria-pressed={likeness === level.value} onClick={() => setLikeness(level.value)}>
                  {level.label}
                </button>
              ))}
            </div>
            <span className="leading-[1.5] text-ink-2">{LIKENESS_LEVELS.find((level) => level.value === likeness)?.text} 실존 인물 사진은 사용 권한을 먼저 확인해 주세요.</span>
          </div>
        ) : null}
      </div>
      <label className="grid gap-1 text-[12px] text-ink-3">
        어떤 사람인가요? 프롬프트에 그대로 들어가요{refs.length ? ' (선택)' : ''}
        <textarea
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          rows={3}
          placeholder="동아시아계 30대 초반 여성, 갸름한 얼굴, 어깨 길이 흑갈색 생머리, 차분하고 따뜻한 인상, 자연스러운 피부 질감"
          className="field h-auto resize-none py-2 leading-[1.5]"
        />
      </label>
      <label className="grid gap-1 text-[12px] text-ink-3">
        키와 체형. 제품과 크기를 맞출 때 써요
        <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="키 165cm, 슬림. 170cm 맥스보다 살짝 작다" className="field h-9" />
      </label>
      {error ? <p className="text-[13px] text-bad">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-line" onClick={onClose}>
          취소
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          모델 프로젝트 만들기
        </button>
      </div>
    </form>
  );
}

function ImageTab({
  images,
  defaultType,
  onOpen,
  empty,
}: {
  images: AssetView[];
  defaultType: AssetType;
  onOpen: (item: LightboxItem) => void;
  empty: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<AssetType>(defaultType);
  const [error, setError] = useState('');

  const upload = () => {
    pickFiles(true, async (files) => {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        form.append('type', type);
        try {
          await api('/api/library/files', { method: 'POST', body: form });
        } catch (e) {
          setError((e as Error).message);
        }
      }
      router.refresh();
    });
  };

  const retag = async (asset: AssetView, next: AssetType) => {
    try {
      if (asset.libraryId) {
        await api(`/api/library/items/${asset.libraryId}`, { method: 'PATCH', body: { type: next } });
      } else if (asset.projectId) {
        await api('/api/library', { method: 'POST', body: { fromProject: asset.projectId, name: asset.name, type: next, title: asset.title } });
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <select aria-label="올릴 사진의 종류" className="field h-9" value={type} onChange={(e) => setType(e.target.value as AssetType)}>
          {(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((value) => (
            <option key={value} value={value}>
              {ASSET_TYPE_LABEL[value]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-line h-9" onClick={upload}>
          <Upload size={14} />
          사진 올리기
        </button>
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
      </div>
      {images.length ? (
        <div className={GRID}>
          {images.map((asset) => (
            <figure key={asset.key} className="min-w-0">
              <button
                type="button"
                aria-label={`${asset.title} 크게 보기`}
                onClick={() => onOpen({ url: asset.url, kind: 'image', title: asset.title, meta: `${asset.width} × ${asset.height}` })}
                className="block aspect-square w-full overflow-hidden rounded-xl bg-fill ring-1 ring-line transition-all duration-200 hover:-translate-y-0.5 hover:ring-line-strong"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.thumb} alt="" loading="lazy" className="h-full w-full object-contain" />
              </button>
              <figcaption className="mt-2">
                <p className="truncate text-[13px] font-medium text-ink">{asset.title}</p>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    aria-label={`${asset.title} 종류`}
                    value={asset.type}
                    onChange={(e) => void retag(asset, e.target.value as AssetType)}
                    className="field h-7 px-1.5 text-[12px]"
                  >
                    {(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((value) => (
                      <option key={value} value={value}>
                        {ASSET_TYPE_LABEL[value]}
                      </option>
                    ))}
                  </select>
                  {asset.projectId ? (
                    <Link href={`/p/${asset.projectId}`} className="truncate text-[12px] text-ink-3 hover:text-brand-dark">
                      {asset.projectName}
                    </Link>
                  ) : null}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <Empty text={empty} />
      )}
    </>
  );
}

const RULE_FIELDS: { key: keyof Omit<RuleSet, 'elements'>; label: string; rows: number }[] = [
  { key: 'style', label: '화풍', rows: 2 },
  { key: 'aspect', label: '화면비', rows: 1 },
  { key: 'characters', label: '캐릭터 키워드', rows: 2 },
  { key: 'camera', label: '카메라 문법', rows: 2 },
  { key: 'product', label: '제품', rows: 3 },
  { key: 'sound', label: '소리', rows: 1 },
  { key: 'banned', label: '금지', rows: 1 },
];

function RuleTab({ rules }: { rules: LibraryRule[] }) {
  const router = useRouter();
  const [list, setList] = useState(rules);
  const [activeId, setActiveId] = useState(rules[0]?.id ?? '');
  const active = list.find((r) => r.id === activeId);

  const patch = async (rule: LibraryRule, change: Partial<RuleSet> | null, title?: string) => {
    const next = { ...rule, title: title ?? rule.title, rule: change ? { ...rule.rule, ...change } : rule.rule };
    setList((items) => items.map((r) => (r.id === rule.id ? next : r)));
    await api(`/api/library/items/${rule.id}`, { method: 'PATCH', body: { title: next.title, rule: next.rule } });
  };

  const copy = async () => {
    const { item } = await api<{ item: LibraryRule }>('/api/library/rules', { method: 'POST', body: { fromId: activeId } });
    setList((items) => [...items, item]);
    setActiveId(item.id);
    router.refresh();
  };

  return (
    <>
      <p className="mb-4 max-w-[720px] text-[14px] leading-[1.6] text-ink-2">
        어떤 시나리오를 넣어도 같은 품질 기준으로 나오게 하는 고정값이에요. 프로젝트마다 하나를 골라 쓰고, 생성할 때 프롬프트에 함께 들어가요.
      </p>
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {list.map((rule) => (
          <button key={rule.id} type="button" className="chip h-8" aria-pressed={rule.id === activeId} onClick={() => setActiveId(rule.id)}>
            {rule.title}
          </button>
        ))}
        <button type="button" className="chip h-8" onClick={() => void copy()}>
          <Plus size={13} />
          복사해서 새로 만들기
        </button>
      </div>
      {active ? (
        <div key={active.id} className="floating grid max-w-[860px] gap-3 p-5">
          <label className="grid gap-1 text-[12px] text-ink-3">
            규칙 이름
            <input
              defaultValue={active.title}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== active.title) void patch(active, null, e.target.value.trim());
              }}
              className="field h-9 max-w-[320px]"
            />
          </label>
          {RULE_FIELDS.map((field) => (
            <label key={field.key} className="grid gap-1 text-[12px] text-ink-3">
              {field.label}
              <textarea
                defaultValue={active.rule[field.key]}
                rows={field.rows}
                onBlur={(e) => {
                  if (e.target.value !== active.rule[field.key]) void patch(active, { [field.key]: e.target.value });
                }}
                className="field h-auto resize-none py-2 leading-[1.5]"
              />
            </label>
          ))}
          <h3 className="mt-2 text-[14px] font-semibold">필수 연출 요소</h3>
          {active.rule.elements.map((element, index) => (
            <label key={element.key} className="grid gap-1 text-[12px] text-ink-3">
              {element.label}
              <textarea
                defaultValue={element.text}
                rows={2}
                onBlur={(e) => {
                  if (e.target.value === element.text) return;
                  const elements = active.rule.elements.map((item, i) => (i === index ? { ...item, text: e.target.value } : item));
                  void patch(active, { elements });
                }}
                className="field h-auto resize-none py-2 leading-[1.5]"
              />
            </label>
          ))}
        </div>
      ) : null}
    </>
  );
}

function PlanTab({
  ideas,
  boards,
  works,
  onOpen,
}: {
  ideas: LibraryIdea[];
  boards: LibraryBoard[];
  works: LibraryWork[];
  onOpen: (item: LightboxItem) => void;
}) {
  const { start, error } = useStartFrom();
  if (!ideas.length && !boards.length && !works.length) return <Empty text="가져온 기획이 없어요." />;
  return (
    <>
      {error ? <p className="mb-4 text-[13px] text-bad">{error}</p> : null}
      {boards.length ? (
        <section className="mb-9">
          <h2 className="mb-3 text-[15px] font-semibold">스토리보드</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {boards.map((board) => (
              <article key={board.id} className="floating flex flex-col p-3">
                {board.sheet || board.shots[0]?.image ? (
                  <button
                    type="button"
                    aria-label={`${board.title} 시트 크게 보기`}
                    onClick={() => onOpen({ url: board.sheet || board.shots[0].image, kind: 'image', title: board.title })}
                    className="mb-3 block aspect-video overflow-hidden rounded-lg bg-fill"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={board.sheet || board.shots[0].image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ) : null}
                <h3 className="text-[14px] font-semibold">{board.title}</h3>
                <p className="mt-1 line-clamp-3 text-[12.5px] leading-[1.5] text-ink-2">{board.scenario}</p>
                <p className="mt-2 text-[12px] text-ink-3">
                  {board.shots.length}컷 · {board.total}초 · {board.aspect}
                </p>
                <button type="button" className="btn btn-line mt-3" onClick={() => void start(board.id)}>
                  이 스토리보드로 시작
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {ideas.length ? (
        <section className="mb-9">
          <h2 className="mb-3 text-[15px] font-semibold">기획안</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {ideas.map((idea) => (
              <article key={idea.id} className="floating flex flex-col p-3">
                {idea.images[0] ? (
                  <button
                    type="button"
                    aria-label={`${idea.title} 시안 크게 보기`}
                    onClick={() => onOpen({ url: idea.images[0].url, kind: 'image', title: idea.title, meta: idea.images[0].caption })}
                    className="mb-3 block aspect-video overflow-hidden rounded-lg bg-fill"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={idea.images[0].url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ) : null}
                <h3 className="text-[14px] font-semibold">{idea.title}</h3>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {idea.tag} · {idea.length}
                </p>
                <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-[1.5] text-ink-2">{idea.logline}</p>
                <p className="mt-2 flex-1 text-[12px] text-ink-3">{idea.status}</p>
                <button type="button" className="btn btn-line mt-3" onClick={() => void start(idea.id)}>
                  이 기획으로 시작
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {works.length ? (
        <section>
          <h2 className="mb-3 text-[15px] font-semibold">제작 기록과 교훈</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {works.map((work) => (
              <article key={work.id} className="floating p-3">
                {work.frames[0] ? (
                  <button
                    type="button"
                    aria-label={`${work.title} 프레임 크게 보기`}
                    onClick={() => onOpen({ url: `/api/library/files/${work.frames[0].file}`, kind: 'image', title: work.title, meta: work.frames[0].caption })}
                    className="mb-3 block aspect-video overflow-hidden rounded-lg bg-fill"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/library/files/${work.frames[0].file}?w=480`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ) : null}
                <h3 className="text-[14px] font-semibold">{work.title}</h3>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {work.type} · {work.aspect}
                </p>
                <ul className="mt-2 grid gap-1 text-[12.5px] leading-[1.5] text-ink-2">
                  {work.lessons.slice(0, 3).map((lesson) => (
                    <li key={lesson}>{lesson}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
