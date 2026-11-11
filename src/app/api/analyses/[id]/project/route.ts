import { startFromAnalysis } from '@/lib/analyze';
import { readBody, route } from '@/lib/http';
import type { FollowLevel } from '@/lib/types';

/** 분석한 구조로 프로젝트를 만든다. 생성은 하지 않는다 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readBody<{ level?: FollowLevel }>(req);
  return Response.json({ project: startFromAnalysis(id, body.level) }, { status: 201 });
});
