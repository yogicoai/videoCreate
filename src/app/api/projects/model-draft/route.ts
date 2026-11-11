import { route } from '@/lib/http';
import { startModelDraft, StoreError } from '@/lib/store';

const MAX_REFS = 3;
const MAX_BYTES = 25 * 1024 * 1024;

/** 새 모델을 만드는 프로젝트를 차린다. 참고 사진을 함께 받는다. 생성은 하지 않는다 */
export const POST = route(async (req) => {
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) throw new StoreError('요청 형식이 올바르지 않아요.', 415);
  const form = await req.formData();
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const refs: { bytes: Buffer; name: string }[] = [];
  for (const file of form.getAll('refs').slice(0, MAX_REFS)) {
    if (!(file instanceof File) || !file.size) continue;
    if (file.size > MAX_BYTES) throw new StoreError('참고 사진은 25MB까지 받아요.');
    refs.push({ bytes: Buffer.from(await file.arrayBuffer()), name: file.name });
  }
  const project = await startModelDraft({
    title: text('title'),
    category: text('category'),
    identity: text('identity'),
    size: text('size'),
    likeness: Number(text('likeness')) || undefined,
    refs,
  });
  return Response.json({ project }, { status: 201 });
});
