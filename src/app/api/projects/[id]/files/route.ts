import { route } from '@/lib/http';
import { addUpload, copyAsset, copyLibraryImage, copyModelImage, copyVideoPoster, StoreError } from '@/lib/store';
import type { ModelVariant } from '@/lib/types';

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

/** 사진 올리기(파일) 또는 자산에서 가져오기(JSON) */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await req.json()) as {
      fromProject?: string;
      name?: string;
      fromLibrary?: string;
      fromVideo?: string;
      fromModel?: string;
      variant?: ModelVariant;
    };
    if (body.fromModel) {
      const variant = body.variant ?? 'rep';
      const { entry, item } = await copyModelImage(id, body.fromModel, variant);
      return Response.json({ file: entry, talent: { libraryId: item.id, title: item.title, variant } }, { status: 201 });
    }
    if (body.fromLibrary) {
      const { entry, item } = await copyLibraryImage(id, body.fromLibrary);
      return Response.json({ file: entry, asset: { type: item.type, title: item.title } }, { status: 201 });
    }
    if (body.fromVideo) {
      const { entry, item } = await copyVideoPoster(id, body.fromVideo);
      return Response.json({ file: entry, video: { libraryId: item.id, title: item.title } }, { status: 201 });
    }
    if (!body.fromProject || !body.name) throw new StoreError('가져올 자산을 알려 주세요.');
    return Response.json({ file: await copyAsset(id, body.fromProject, body.name) }, { status: 201 });
  }
  if (!type.includes('multipart/form-data')) throw new StoreError('파일을 올려 주세요.', 415);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new StoreError('파일이 없어요.');
  if (file.size > MAX_UPLOAD_BYTES) throw new StoreError('40MB보다 큰 사진은 올릴 수 없어요.');
  const entry = await addUpload(id, Buffer.from(await file.arrayBuffer()), file.name);
  return Response.json({ file: entry }, { status: 201 });
});
