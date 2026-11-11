import { notFound } from 'next/navigation';
import { Editor } from '@/components/canvas/Editor';
import { engineStatus } from '@/lib/engine/registry';
import { ensureRules, getBalance, getCanvas, getProject, hasProject, jobsView } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: hasProject(id) ? `${getProject(id).name} · 영상제작` : '영상제작' };
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { c } = await searchParams;
  if (!hasProject(id)) notFound();
  ensureRules();
  const project = getProject(id);
  const canvasId = project.canvases.some((canvas) => canvas.id === c) ? (c as string) : project.canvases[0].id;
  const { jobs, stats, boards } = jobsView(id);

  return (
    <Editor
      initialProject={project}
      initialCanvas={getCanvas(id, canvasId)}
      initialJobs={jobs}
      initialStats={stats}
      initialBoards={boards}
      initialBalance={getBalance()}
      engines={engineStatus()}
    />
  );
}
