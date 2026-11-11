import { kick } from '@/lib/engine/runner';
import { readBody, route } from '@/lib/http';
import { canvasRevisions, createJobs, getBalance, jobsView, StoreError } from '@/lib/store';

export const GET = route<{ id: string }>((_req, { id }) => {
  kick(id);
  return Response.json({ ...jobsView(id), balance: getBalance(), revisions: canvasRevisions(id) });
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readBody<{ canvasId?: string; nodeIds?: string[]; allowDirect?: boolean }>(req);
  if (!body.canvasId || !Array.isArray(body.nodeIds) || !body.nodeIds.length) {
    throw new StoreError('대기열에 넣을 칸을 골라 주세요.');
  }
  // 제미나이·GPT는 비용을 확인한 화면에서 allowDirect 를 켜서 보낼 때만 받는다
  const outcome = createJobs(id, body.canvasId, body.nodeIds, body.allowDirect === true);
  kick(id);
  return Response.json({ ...outcome, ...jobsView(id) });
});
