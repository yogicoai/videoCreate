import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Editor } from '@/components/canvas/Editor';
import { engineStatus } from '@/lib/engine/registry';
import { isOnline } from '@/lib/online';
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
  // 온라인 판은 보기 전용이라 캔버스를 열지 않는다. 캔버스의 재료(참조 사진, 중간 결과)는 올리지 않는다
  if (isOnline()) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">{getProject(id).name}</h1>
        <p className="max-w-md text-sm opacity-70">캔버스는 작업하는 PC에서만 열려요. 온라인에서는 갤러리에서 결과물을 볼 수 있어요.</p>
        <Link href={`/gallery/p${id}`} className="rounded-lg border border-white/15 px-4 py-2 text-sm">
          이 프로젝트의 결과물 보기
        </Link>
      </main>
    );
  }
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
