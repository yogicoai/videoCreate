'use client';

import { Check, Film, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, fileUrl, formatDate } from '@/lib/client';
import { formatNumber, STEPS } from '@/lib/models';
import type { CostStats, ProjectSummary } from '@/lib/types';
import { ConfirmDialog, type ConfirmRequest } from './canvas/Overlays';
import { useCreateProject } from './Sidebar';

function spentLabel(stats: CostStats): string {
  const parts: string[] = [];
  if (stats.credits.actual > 0) parts.push(`${formatNumber(stats.credits.actual)}크레딧`);
  if (stats.krw.actual > 0) parts.push(`₩${formatNumber(stats.krw.actual)}`);
  if (parts.length) return parts.join(' · ');
  if (stats.credits.estimated > 0) return `추정 ${formatNumber(stats.credits.estimated)}크레딧`;
  if (stats.krw.estimated > 0) return `추정 ₩${formatNumber(stats.krw.estimated)}`;
  return '';
}

function ProjectCard({
  project,
  onRenamed,
  onDelete,
}: {
  project: ProjectSummary;
  onRenamed: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [error, setError] = useState('');

  const commit = async () => {
    const next = name.trim();
    setEditing(false);
    if (!next || next === project.name) {
      setName(project.name);
      return;
    }
    try {
      await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: next } });
      onRenamed(next);
      setError('');
    } catch (e) {
      setName(project.name);
      setError((e as Error).message);
    }
  };

  const spent = spentLabel(project.stats);

  return (
    <article className="group min-w-0">
      <Link
        href={`/p/${project.id}`}
        aria-label={`${project.name} 열기`}
        className="relative block aspect-[16/10] overflow-hidden rounded-2xl bg-fill ring-1 ring-line transition-all duration-200 group-hover:-translate-y-0.5 group-hover:ring-line-strong"
      >
        {project.thumb?.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(project.id, project.thumb.file, 480)} alt="" className="h-full w-full object-cover" />
        ) : project.thumb?.kind === 'video' ? (
          <video src={fileUrl(project.id, project.thumb.file)} preload="metadata" muted className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink-4">
            <Film size={28} strokeWidth={1.5} />
          </span>
        )}
      </Link>
      <div className="mt-2.5 flex items-center gap-1">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setName(project.name);
                  setEditing(false);
                }
              }}
              aria-label="프로젝트 이름"
              className="field h-7 min-w-0 flex-1 text-[14px] font-semibold"
            />
            <button type="submit" className="icon-btn h-7 w-7" aria-label="이름 저장" onMouseDown={(e) => e.preventDefault()}>
              <Check size={15} />
            </button>
          </form>
        ) : (
          <>
            <Link href={`/p/${project.id}`} className="min-w-0 truncate text-[14px] font-semibold text-ink">
              {project.name}
            </Link>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`${project.name} 이름 바꾸기`}
              className="icon-btn h-6 w-6 flex-none opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`${project.name} 지우기`}
              className="icon-btn ml-auto h-6 w-6 flex-none opacity-0 transition-opacity hover:!text-bad focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      <div className="mt-1.5 flex gap-0.5" role="img" aria-label={`7단계 중 ${project.steps.filter(Boolean).length}단계 끝남`}>
        {project.steps.map((done, index) => (
          <i key={index} title={STEPS[index]} className={`h-[3px] flex-1 rounded-full ${done ? 'bg-brand' : 'bg-line'}`} />
        ))}
      </div>
      <p className="mt-1.5 flex gap-1.5 text-[12px] text-ink-3">
        <span>{formatDate(project.updatedAt)}</span>
        {spent ? <span>· {spent}</span> : null}
      </p>
      {error ? <p className="mt-1 text-[12px] text-bad">{error}</p> : null}
    </article>
  );
}

export function ProjectGrid({ initial }: { initial: ProjectSummary[] }) {
  const [projects, setProjects] = useState(initial);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [error, setError] = useState('');
  const { create, creating } = useCreateProject();

  const refresh = useCallback(async () => {
    try {
      const { projects: next } = await api<{ projects: ProjectSummary[] }>('/api/projects');
      setProjects(next);
    } catch {
      // 다음에 돌아올 때 다시 읽는다
    }
  }, []);

  useEffect(() => {
    // 캔버스에서 뒤로 왔을 때 이름과 크레딧을 새로 읽는다
    const timer = setTimeout(() => void refresh(), 0);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const remove = (project: ProjectSummary) => {
    const spent = spentLabel(project.stats);
    setConfirmRequest({
      title: `'${project.name}'을 지울까요?`,
      body: `칸과 결과물이 갤러리에서도 함께 사라져요.${spent ? `\n이 프로젝트에 쓴 비용: ${spent}` : ''}`,
      confirmLabel: '지우기',
      danger: true,
      resolve: async (ok) => {
        setConfirmRequest(null);
        if (!ok) return;
        try {
          await api(`/api/projects/${project.id}`, { method: 'DELETE' });
          setProjects((list) => list.filter((p) => p.id !== project.id));
          setError('');
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  };

  return (
    <>
      {error ? <p className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-5 gap-y-7">
        <div>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-gradient-to-b from-fill to-fill-2 text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong"
          >
            <Plus size={24} strokeWidth={1.6} />
            <span className="text-[14px] font-semibold">제작 시작</span>
          </button>
          <p className="mt-2.5 text-[13px] text-ink-3">새 영상 프로젝트 만들기</p>
        </div>
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onRenamed={(name) => setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, name } : p)))}
            onDelete={() => remove(project)}
          />
        ))}
      </div>
      {confirmRequest ? <ConfirmDialog request={confirmRequest} /> : null}
    </>
  );
}
