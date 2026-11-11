import type { Metadata } from 'next';
import { AnalyzeView } from '@/components/Analyze';
import { listAnalyses } from '@/lib/analyze';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '숏츠 가져오기 · 영상제작' };

export default async function AnalyzePage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  return <AnalyzeView initial={listAnalyses()} initialOpen={open} />;
}
