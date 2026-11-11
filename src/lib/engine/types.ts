import type { Cost, EngineId } from '../types.ts';

export type InlineImage = { mimeType: string; data: string };

export type EngineInput = {
  /** 규칙 문장까지 붙은 최종 프롬프트 */
  prompt: string;
  /** 번호 순서대로 들어간 참조 */
  references: InlineImage[];
  aspect: string;
  resolution?: string;
};

export type EngineOutput = {
  bytes: Buffer;
  /** 응답의 사용량으로 계산한 비용. 사용량이 없으면 null(예상값을 추정으로 남긴다) */
  actual: Cost | null;
  model: string;
};

/**
 * 앱에서 바로 생성하는 엔진의 자리.
 * 힉스필드를 앱에서 바로 부를 수 있게 되면 이 모양으로 하나 더 만들어 registry 에 끼우면 된다.
 */
export interface DirectEngine {
  id: EngineId;
  configured(): boolean;
  generate(input: EngineInput): Promise<EngineOutput>;
}

export class EngineError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'EngineError';
    this.status = status;
  }
}
