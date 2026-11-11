import { EngineError, type DirectEngine, type EngineInput, type EngineOutput } from './types.ts';

/**
 * 나노바나나(Gemini Image). imgCreate 의 gemini.ts 에서 실전 검증된 부분을 옮겼다.
 *
 * 이 키는 imgCreate·Dong 앱과 선불 잔액, 월 지출 한도를 함께 쓴다.
 * 실패하면 구글 원문을 그대로 남긴다(402 = 선불 잔액 없음, 429 = 월 지출 한도 또는 몰림).
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// gemini-3-pro-image 공식 단가. 사고 토큰도 출력 단가로 과금된다
const PRICE_IN_PER_TOKEN = 2.0 / 1_000_000;
const PRICE_OUT_PER_TOKEN = 120.0 / 1_000_000;
const USD_TO_KRW = () => Number(process.env.USD_TO_KRW) || 1400;

const ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 180_000;

type GoogleResponse = {
  candidates?: { content?: { parts?: Record<string, unknown>[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
  };
};

function rawMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // 아래에서 본문을 그대로 쓴다
  }
  return body.slice(0, 600) || '구글이 내용 없이 실패를 돌려줬어요.';
}

/** 429 중에서도 기다려도 소용없는 경우(결제 한도, 일일 한도)를 가른다 */
function isHardQuota(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; details?: Record<string, unknown>[] } };
    if (/exceeded your current quota|check your plan|billing|spend/i.test(parsed.error?.message ?? '')) return true;
    const quota = (parsed.error?.details ?? []).find((d) => String(d['@type'] ?? '').endsWith('QuotaFailure'));
    const violations = (quota?.violations ?? []) as Record<string, unknown>[];
    return violations.some((v) => /per\s*day|perday/i.test(`${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`));
  } catch {
    return false;
  }
}

const isRetryable = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function actualCost(model: string, usage: GoogleResponse['usageMetadata']): EngineOutput['actual'] {
  if (!usage || !model.includes('pro-image')) return null; // 단가를 아는 모델만 계산한다
  const promptTokens = usage.promptTokenCount ?? 0;
  const imageTokens =
    usage.candidatesTokensDetails?.find((d) => d.modality === 'IMAGE')?.tokenCount ?? usage.candidatesTokenCount ?? 0;
  const thoughtTokens = usage.thoughtsTokenCount ?? 0;
  const usd = promptTokens * PRICE_IN_PER_TOKEN + (imageTokens + thoughtTokens) * PRICE_OUT_PER_TOKEN;
  return { unit: 'krw', amount: Math.round(usd * USD_TO_KRW()) };
}

export const geminiEngine: DirectEngine = {
  id: 'gemini',
  configured: () => !!process.env.GEMINI_API_KEY,

  async generate(input: EngineInput): Promise<EngineOutput> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new EngineError('GEMINI_API_KEY 가 없어요 (.env.local).', 503);

    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
    const size = (input.resolution || process.env.GEMINI_IMAGE_SIZE || '2K').toUpperCase();
    const body = JSON.stringify({
      contents: [
        {
          parts: [
            ...input.references.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
            { text: input.prompt },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: input.aspect, imageSize: size },
      },
    });

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        // 연결이 끊긴 경우는 청구 여부를 알 수 없어 자동으로 다시 보내지 않는다
        throw new EngineError(`제미나이에 연결하지 못했어요: ${(e as Error).message}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const canRetry = isRetryable(res.status) && !(res.status === 429 && isHardQuota(text)) && attempt < ATTEMPTS;
        if (canRetry) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw new EngineError(rawMessage(text), res.status);
      }

      const json = (await res.json()) as GoogleResponse;
      if (json.promptFeedback?.blockReason) {
        throw new EngineError(`안전 필터에 막혔어요: ${json.promptFeedback.blockReason}`, 422);
      }
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        const inline = (part.inlineData ?? part.inline_data) as { data?: string } | undefined;
        if (inline?.data) {
          return { bytes: Buffer.from(inline.data, 'base64'), actual: actualCost(model, json.usageMetadata), model };
        }
      }
      // 이미지 없이 글만 오는 경우가 가끔 있다. 다시 보내면 대개 나온다
      if (attempt < ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw new EngineError('응답에 그림이 없어요 (모델이 글만 돌려줬어요).', 502);
    }
  },
};
