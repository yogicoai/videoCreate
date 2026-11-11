import { listAnalyses, startAnalysis } from '@/lib/analyze';
import { readBody, route } from '@/lib/http';
import { StoreError } from '@/lib/store';

export const GET = route(() => Response.json({ analyses: listAnalyses() }));

/** 레퍼런스 영상을 분석한다. 크레딧이 들지 않는다 */
export const POST = route(async (req) => {
  const body = await readBody<{ url?: string }>(req);
  if (!body.url) throw new StoreError('영상 주소를 넣어 주세요.');
  return Response.json({ analysis: startAnalysis(body.url) }, { status: 201 });
});
