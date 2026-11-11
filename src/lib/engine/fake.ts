import sharp from 'sharp';
import { aspectToRatio } from '../models.ts';
import type { EngineId } from '../types.ts';
import { EngineError, type DirectEngine, type EngineInput, type EngineOutput } from './types.ts';

/**
 * 시험용 가짜 엔진. VIDEOCREATE_FAKE_ENGINE=1 일 때만 쓰며 바깥으로 아무것도 보내지 않는다.
 * 프롬프트에 [가짜402], [가짜429] 를 넣으면 구글이 돌려주는 실패를 흉내 낸다.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const COLORS: Record<string, string> = { gemini: '#CFE8F4', openai: '#E4E0F5', higgsfield: '#DDEFE3' };

export function fakeEngine(id: EngineId): DirectEngine {
  return {
    id,
    configured: () => true,
    async generate(input: EngineInput): Promise<EngineOutput> {
      await sleep(Number(process.env.VIDEOCREATE_FAKE_DELAY_MS) || 1200);
      if (input.prompt.includes('[가짜402]')) {
        throw new EngineError('Your prepaid credits are depleted. Please go to AI Studio to manage your project and billing.', 402);
      }
      if (input.prompt.includes('[가짜429]')) {
        throw new EngineError('Your project has exceeded its monthly spending cap.', 429);
      }
      const ratio = aspectToRatio(input.aspect);
      const width = ratio >= 1 ? 1024 : Math.round(1024 * ratio);
      const height = ratio >= 1 ? Math.round(1024 / ratio) : 1024;
      const dots = input.references
        .map((_, i) => `<circle cx="${60 + i * 70}" cy="60" r="24" fill="#3FA6D3"/>`)
        .join('');
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
           <rect x="40" y="${height / 2 - 40}" width="${width - 80}" height="80" rx="12" fill="#ffffff" opacity="0.7"/>
           ${dots}
         </svg>`,
      );
      const bytes = await sharp({ create: { width, height, channels: 3, background: COLORS[id] } })
        .composite([{ input: svg }])
        .png()
        .toBuffer();
      return { bytes, actual: { unit: 'krw', amount: id === 'gemini' ? 271 : 340 }, model: `fake-${id}` };
    },
  };
}
