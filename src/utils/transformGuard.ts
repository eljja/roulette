export function transformGuard(ctx: CanvasRenderingContext2D, func: (ctx: CanvasRenderingContext2D) => void): void {
  ctx.save();
  func(ctx);
  ctx.restore();
}
