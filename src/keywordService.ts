export class KeywordService {
  async init(): Promise<void> {
    // 외부 API 통신 제거 (독립 실행)
  }

  destroy(): void {}

  getSprite(_marbleName: string): CanvasImageSource | undefined {
    return undefined;
  }
}
