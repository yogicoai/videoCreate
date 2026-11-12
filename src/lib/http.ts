import { isOnline } from './online.ts';
import { StoreError } from './store.ts';

type Ctx<P> = { params: Promise<P> };

/** 라우트 공통 처리. 예상한 오류는 그 문구를 그대로, 나머지는 서버 로그에 남긴다 */
export function route<P = Record<string, never>>(handler: (req: Request, params: P) => Promise<Response> | Response) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    // 온라인 판은 보기 전용이다. 로그인이 없어서 고치거나 생성하는 요청은 받지 않는다
    if (isOnline() && req.method !== 'GET' && req.method !== 'HEAD') {
      return Response.json({ error: '온라인에서는 보기만 할 수 있어요.' }, { status: 403 });
    }
    try {
      return await handler(req, await ctx.params);
    } catch (e) {
      if (e instanceof StoreError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: '처리하지 못했어요. 서버 기록을 확인해 주세요.' }, { status: 500 });
    }
  };
}

export async function readBody<T>(req: Request): Promise<T> {
  // 다른 사이트는 사전 확인 없이 JSON 형식으로 보낼 수 없다. 바로 결제되는 요청을 몰래 보내지 못하게 막는다
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    throw new StoreError('JSON 요청만 받아요.', 415);
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new StoreError('요청 내용을 읽지 못했어요.');
  }
}
