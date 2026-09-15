import { initialZoom, zoomThreshold } from './data/constants';
import type { StageDef } from './data/maps';
import type { Marble } from './marble';
import type { VectorLike } from './types/VectorLike';

export class Camera {
  private _position: VectorLike = { x: 0, y: 0 };
  private _targetPosition: VectorLike = { x: 0, y: 0 };
  private _zoom: number = 1;
  private _targetZoom: number = 1;
  private _locked = false;
  private _shouldFollowMarbles = false;
  private _isManual = false;

  get zoom() {
    return this._zoom;
  }

  set zoom(v: number) {
    this._targetZoom = v;
  }

  get x() {
    return this._position.x;
  }

  set x(v: number) {
    this._targetPosition.x = v;
  }

  get y() {
    return this._position.y;
  }

  set y(v: number) {
    this._targetPosition.y = v;
  }

  get position() {
    return this._position;
  }

  get isManual(): boolean {
    return this._isManual;
  }

  setPosition(v: VectorLike, force: boolean = false) {
    if (force) {
      return (this._position = { x: v.x, y: v.y });
    }
    return (this._targetPosition = { x: v.x, y: v.y });
  }

  pan(dx: number, dy: number) {
    this._isManual = true;
    this._targetPosition.x += dx;
    this._targetPosition.y += dy;
  }

  resetManual() {
    this._isManual = false;
    this._locked = false;
    this._shouldFollowMarbles = true;
  }

  lock(v: boolean) {
    this._locked = v;
    if (v) {
      this._isManual = true;
    }
  }

  startFollowingMarbles() {
    this._shouldFollowMarbles = true;
    this._isManual = false;
  }

  initializePosition(center?: VectorLike, zoom?: number) {
    const x = center?.x ?? 12.95;
    const y = center?.y ?? 2;
    const z = zoom ?? 1;

    this._position = { x, y };
    this._targetPosition = { x, y };
    this._zoom = z;
    this._targetZoom = z;
    this._shouldFollowMarbles = false;
    this._isManual = false;
  }

  update({
    marbles,
    stage,
    needToZoom,
    targetIndex,
  }: {
    marbles: Marble[];
    stage: StageDef;
    needToZoom: boolean;
    targetIndex: number;
  }) {
    // 수동 조작(방향키 또는 미니맵 드래그)이 아닐 때만 자동 추적
    if (!this._locked && !this._isManual) {
      this._calcTargetPositionAndZoom(marbles, stage, needToZoom, targetIndex);
    }

    // 부드러운 위치 보간 (스냅 없이 연속적인 감속 보간 적용)
    this._position.x = this._interpolation(this.x, this._targetPosition.x, 24);
    this._position.y = this._interpolation(this.y, this._targetPosition.y, 14);

    // 초반 줌 아웃 시 급격한 수축을 완화하기 위해 완만하게 보간 (delta 35)
    this._zoom = this._interpolation(this._zoom, this._targetZoom, 35);
  }

  private _calcTargetPositionAndZoom(marbles: Marble[], stage: StageDef, needToZoom: boolean, targetIndex: number) {
    if (!this._shouldFollowMarbles) {
      return;
    }

    if (marbles.length > 0) {
      const leadMarble = marbles[targetIndex] ?? marbles[0];
      let targetX = leadMarble.x;
      const targetY = leadMarble.y;

      // 선두 그룹(상위 5개 또는 1등과 Y좌표 차이가 2.5 이내인 구슬들)의 X좌표 평균을 취해
      // 1등이 좌우로 튈 때 카메라가 좌우로 요동치는 떨림을 완벽히 방지
      const leadGroup = marbles.slice(0, Math.min(5, marbles.length)).filter((m) => Math.abs(m.y - leadMarble.y) < 2.5);

      if (leadGroup.length > 1) {
        targetX = leadGroup.reduce((sum, m) => sum + m.x, 0) / leadGroup.length;
      }

      this.setPosition({ x: targetX, y: targetY });

      if (needToZoom) {
        const goalDist = Math.abs(stage.zoomY - this._position.y);
        this.zoom = Math.max(1, (1 - goalDist / zoomThreshold) * 4);
      } else {
        this.zoom = 1;
      }
    } else {
      this.zoom = 1;
    }
  }

  private _interpolation(current: number, target: number, delta: number = 10) {
    const d = target - current;
    // 인위적인 스냅(snap) 제거: 완전히 연속적이고 부드러운 감속 이동 유지
    return current + d / delta;
  }

  renderScene(ctx: CanvasRenderingContext2D, callback: (ctx: CanvasRenderingContext2D) => void) {
    const zoomFactor = initialZoom * 2 * this._zoom;
    ctx.save();
    ctx.translate(-this.x * this._zoom, -this.y * this._zoom);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(ctx.canvas.width / zoomFactor, ctx.canvas.height / zoomFactor);
    callback(ctx);
    ctx.restore();
  }
}
