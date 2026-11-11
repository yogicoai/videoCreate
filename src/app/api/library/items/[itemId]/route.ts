import { readBody, route } from '@/lib/http';
import { updateLibraryImage, updateRule } from '@/lib/store';
import type { AssetType, RuleSet } from '@/lib/types';

/** 자산의 이름·종류, 제작 규칙의 내용을 고친다 */
export const PATCH = route<{ itemId: string }>(async (req, { itemId }) => {
  const body = await readBody<{ title?: string; type?: AssetType; rule?: Partial<RuleSet> }>(req);
  if (body.rule) return Response.json({ item: updateRule(itemId, body) });
  return Response.json({ item: updateLibraryImage(itemId, body) });
});
