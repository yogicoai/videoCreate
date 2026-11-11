import { readBody, route } from '@/lib/http';
import { createRule } from '@/lib/store';

/** 규칙을 복사해 새로 만든다 */
export const POST = route(async (req) => {
  const body = await readBody<{ fromId?: string }>(req);
  return Response.json({ item: createRule(body.fromId) }, { status: 201 });
});
