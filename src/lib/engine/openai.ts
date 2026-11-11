import { gptSize } from '../models.ts';
import { EngineError, type DirectEngine, type EngineInput, type EngineOutput } from './types.ts';

/**
 * GPT 이미지. imgCreate 의 openai-image.ts 와 같은 방식으로 부른다.
 * 참조가 있으면 edits, 없으면 generations 를 쓴다. 최대 1536px 이다.
 */

const USD_TO_KRW = () => Number(process.env.USD_TO_KRW) || 1400;
const REQUEST_TIMEOUT_MS = 240_000;

type OpenAIResponse = {
  data?: { b64_json?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
};

/** gpt-image-1 단가(1M 토큰당 글 입력 $5, 그림 입력 $10, 그림 출력 $40). 참고치이며 청구서가 기준이다 */
function actualCost(model: string, usage: OpenAIResponse['usage']): EngineOutput['actual'] {
  if (!usage || model !== 'gpt-image-1') return null;
  const text = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0;
  const image = usage.input_tokens_details?.image_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const usd = (text * 5 + image * 10 + output * 40) / 1_000_000;
  return { unit: 'krw', amount: Math.round(usd * USD_TO_KRW()) };
}

export const openaiEngine: DirectEngine = {
  id: 'openai',
  configured: () => !!process.env.OPENAI_API_KEY,

  async generate(input: EngineInput): Promise<EngineOutput> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new EngineError('OPENAI_API_KEY 가 없어요 (.env.local).', 503);

    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    const { size } = gptSize(input.aspect);
    const prompt = input.prompt.slice(0, 32000);

    let res: Response;
    try {
      if (input.references.length) {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        form.append('size', size);
        form.append('quality', 'high');
        form.append('n', '1');
        input.references.forEach((ref, index) => {
          const bytes = Buffer.from(ref.data, 'base64');
          const ext = ref.mimeType.includes('png') ? 'png' : 'jpg';
          form.append('image[]', new File([new Uint8Array(bytes)], `ref${index + 1}.${ext}`, { type: ref.mimeType }));
        });
        res = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } else {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt, size, quality: 'high', n: 1 }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      }
    } catch (e) {
      throw new EngineError(`GPT에 연결하지 못했어요: ${(e as Error).message}`);
    }

    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 600) || `OpenAI ${res.status}`;
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message || message;
      } catch {
        // 본문을 그대로 쓴다
      }
      throw new EngineError(message, res.status);
    }
    const json = JSON.parse(text) as OpenAIResponse;
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new EngineError('응답에 그림이 없어요.', 502);
    return { bytes: Buffer.from(b64, 'base64'), actual: actualCost(model, json.usage), model };
  },
};
