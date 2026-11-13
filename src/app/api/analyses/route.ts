import { type AnalysisKind, listAnalyses, startAnalysis } from '@/lib/analyze';
import { readBody, route } from '@/lib/http';
import { StoreError } from '@/lib/store';

const kindParam = (value: string | null | undefined): AnalysisKind => (value === 'video' ? 'video' : 'shorts');

/** ?kind=video 면 영상 가져오기, 아니면 숏츠 가져오기 목록 */
export const GET = route((req) => Response.json({ analyses: listAnalyses(kindParam(new URL(req.url).searchParams.get('kind'))) }));

/** 레퍼런스 영상을 분석한다. 크레딧이 들지 않는다 */
export const POST = route(async (req) => {
  const body = await readBody<{ url?: string; kind?: string }>(req);
  if (!body.url) throw new StoreError('영상 주소를 넣어 주세요.');
  return Response.json({ analysis: startAnalysis(body.url, kindParam(body.kind)) }, { status: 201 });
});
