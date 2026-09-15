import type { RenderParameters } from './rouletteRenderer';
import type { Rect } from './types/rect.type';
import type { MouseEventArgs, UIObject } from './UIObject';

export class FastForwader implements UIObject {
  private icon: HTMLImageElement;

  constructor() {
    this.icon = new Image();
    this.icon.src = new URL('../assets/images/ff.svg', import.meta.url).toString();
  }

  private isEnabled: boolean = false;

  public get speed(): number {
    return this.isEnabled ? 2 : 1;
  }

  update(_deltaTime: number): void {}

  render(ctx: CanvasRenderingContext2D, _params: RenderParameters, width: number, height: number): void {
    if (this.isEnabled) {
      const centerX = width / 2;
      const centerY = height / 2;
      ctx.save();
      ctx.strokeStyle = 'white';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.icon, centerX - 100, centerY - 100, 200, 200);
      ctx.restore();
    }
  }

  getBoundingBox(): Rect | null {
    return null;
  }

  onMouseDown?(e?: MouseEventArgs): void {
    // 마우스 우클릭(button === 2) 시에만 2배속 활성화
    this.isEnabled = e !== undefined && e.button === 2;
  }

  onMouseUp?(e?: MouseEventArgs): void {
    if (!e || e.button === 2) {
      this.isEnabled = false;
    }
  }
}
