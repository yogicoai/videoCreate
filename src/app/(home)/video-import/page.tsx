import type { Metadata } from 'next';
import { VideoImportView } from '@/components/VideoImport';
import { listAnalyses } from '@/lib/analyze';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '영상 가져오기 · 영상제작' };

export default async function VideoImportPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  return <VideoImportView initial={listAnalyses('video')} initialOpen={open} />;
}
