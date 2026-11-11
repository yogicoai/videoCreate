import { route } from '@/lib/http';
import { libraryVideo, StoreError } from '@/lib/store';

/**
 * 내 영상 재생. 원본은 Cafe24에 .jpg 이름으로 저장되어 있어(mp4 업로드가 막혀 있다) 그대로는 재생되지 않는다.
 * 파일을 복사하지 않고 영상 형식으로 바꿔 흘려보낸다. Range 를 넘겨 앞뒤로 옮기기도 된다.
 * 주소는 가져올 때 적어 둔 값만 쓰고, 요청에서 받지 않는다.
 */
export const GET = route<{ itemId: string }>(async (req, { itemId }) => {
  const item = libraryVideo(itemId);
  const range = req.headers.get('range');
  const upstream = await fetch(`${item.origin}/${item.key}`, { headers: range ? { range } : {} });
  if (!upstream.ok && upstream.status !== 206) throw new StoreError('영상을 불러오지 못했어요.', 502);
  const headers = new Headers({
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=86400',
  });
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
});
