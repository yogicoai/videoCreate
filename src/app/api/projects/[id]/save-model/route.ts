import { route } from '@/lib/http';
import { saveModelFromDraft } from '@/lib/store';

/** 끝난 시트를 내 모델로 저장한다 */
export const POST = route<{ id: string }>(async (_req, { id }) => Response.json({ model: await saveModelFromDraft(id) }));
