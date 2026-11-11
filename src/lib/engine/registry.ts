import type { EngineId, EngineStatus } from '../types.ts';
import { fakeEngine } from './fake.ts';
import { geminiEngine } from './gemini.ts';
import { openaiEngine } from './openai.ts';
import type { DirectEngine } from './types.ts';

export const isFakeMode = () => process.env.VIDEOCREATE_FAKE_ENGINE === '1';

/** 앱에서 바로 부를 수 있는 엔진. 힉스필드는 대화의 MCP로만 쓸 수 있어 여기에 없다 */
export function directEngine(id: EngineId): DirectEngine | null {
  if (id === 'higgsfield') return null;
  if (isFakeMode()) return fakeEngine(id);
  return id === 'gemini' ? geminiEngine : openaiEngine;
}

export function engineStatus(): EngineStatus {
  return {
    gemini: directEngine('gemini')?.configured() ?? false,
    openai: directEngine('openai')?.configured() ?? false,
    fake: isFakeMode(),
  };
}
