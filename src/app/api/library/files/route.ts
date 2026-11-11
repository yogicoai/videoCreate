import { route } from '@/lib/http';
import { addLibraryImage, StoreError } from '@/lib/store';
import type { AssetType } from '@/lib/types';

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const TYPES: AssetType[] = ['character', 'product', 'background', 'other'];

/** 자산 화면에서 사진을 바로 올린다 */
export const POST = route(async (req) => {
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) throw new StoreError('파일을 올려 주세요.', 415);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new StoreError('파일이 없어요.');
  if (file.size > MAX_UPLOAD_BYTES) throw new StoreError('40MB보다 큰 사진은 올릴 수 없어요.');
  const type = TYPES.find((t) => t === form.get('type')) ?? 'other';
  const title = String(form.get('title') ?? '') || file.name.replace(/\.[^.]+$/, '');
  const item = await addLibraryImage(Buffer.from(await file.arrayBuffer()), file.name, type, title);
  return Response.json({ item }, { status: 201 });
});
