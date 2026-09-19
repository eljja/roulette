import { initialZoom, zoomThreshold } from './data/constants';
import type { StageDef } from './data/maps';
import type { Marble } from './marble';
import type { VectorLike } from './types/VectorLike';

/**
 * Critically damped spring interpolation (SmoothDamp)
 * Guarantees C1 velocity continuity: the velocity vector NEVER changes abruptly.
 */
function smoothDamp(
  current: number,
  target: number,
  velocityRef: { val: number },
  smoothTime: number,
  maxSpeed: number,
  deltaTime: number
): number {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;

  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;

  // Clamp maximum speed smoothly
  const maxChange = maxSpeed * smoothTime;
  change = Math.max(-maxChange, Math.min(maxChange, change));
  const targetPos = current - change;

  const temp = (velocityRef.val + omega * change) * deltaTime;
  velocityRef.val = (velocityRef.val - omega * temp) * exp;
  return targetPos + (change + temp) * exp;
}

export class Camera {
  private _position: VectorLike = { x: 0, y: 0 };
  private _targetPosition: VectorLike = { x: 0, y: 0 };
  private _filteredTarget: VectorLike = { x: 0, y: 0 };
  private _velocity: VectorLike = { x: 0, y: 0 };

  private _zoom: number = 1;
  private _targetZoom: number = 1;
  private _zoomVelocity: number = 0;

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
    this._filteredTarget.x = v;
  }

  get y() {
    return this._position.y;
  }

  set y(v: number) {
    this._targetPosition.y = v;
    this._filteredTarget.y = v;
  }

  get position() {
    return this._position;
  }

  get isManual(): boolean {
    return this._isManual;
  }

  setPosition(v: VectorLike, force: boolean = false) {
    if (force) {
      this._position = { x: v.x, y: v.y };
      this._targetPosition = { x: v.x, y: v.y };
      this._filteredTarget = { x: v.x, y: v.y };
      this._velocity = { x: 0, y: 0 };
      return this._position;
    }
    this._targetPosition = { x: v.x, y: v.y };
    this._filteredTarget = { x: v.x, y: v.y };
    return this._targetPosition;
  }

  pan(dx: number, dy: number, immediate: boolean = false) {
    this._isManual = true;
    this._targetPosition.x += dx;
    this._targetPosition.y += dy;
    this._filteredTarget.x = this._targetPosition.x;
    this._filteredTarget.y = this._targetPosition.y;
    if (immediate) {
      this._position.x += dx;
      this._position.y += dy;
      this._velocity.x = 0;
      this._velocity.y = 0;
    }
  }

  zoomBy(factor: number) {
    const newZoom = Math.max(0.2, Math.min(5.0, this._targetZoom * factor));
    this._targetZoom = newZoom;
    this._zoom = newZoom;
  }

  resetManual() {
    this._isManual = false;
    this._locked = false;
    this._shouldFollowMarbles = true;
  }

  lock(v: boolean) {
    this._locked = v;
    this._isManual = v;
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
    this._filteredTarget = { x, y };
    this._velocity = { x: 0, y: 0 };
    this._zoom = z;
    this._targetZoom = z;
    this._zoomVelocity = 0;
    this._shouldFollowMarbles = false;
    this._isManual = false;
  }

  update({
    marbles,
    stage,
    needToZoom,
    targetIndex,
    deltaTime = 0.016,
  }: {
    marbles: Marble[];
    stage: StageDef;
    needToZoom: boolean;
    targetIndex: number;
    deltaTime?: number;
  }) {
    const dt = Math.max(0.001, Math.min(0.1, deltaTime));

    // 수동 조작(방향키 또는 미니맵 드래그)이 아닐 때만 자동 추적 타겟 계산
    if (!this._locked && !this._isManual) {
      this._calcTargetPositionAndZoom(marbles, stage, needToZoom, targetIndex, dt);
    }

    // 2차 임계 감쇠 스프링(SmoothDamp)을 적용하여 속도 벡터(Velocity Vector)의 급격한 변화를 원천 제거
    const vxRef = { val: this._velocity.x };
    const vyRef = { val: this._velocity.y };

    this._position.x = smoothDamp(this._position.x, this._targetPosition.x, vxRef, 0.28, 80, dt);
    this._position.y = smoothDamp(this._position.y, this._targetPosition.y, vyRef, 0.28, 80, dt);

    this._velocity.x = vxRef.val;
    this._velocity.y = vyRef.val;

    // 줌 속도 벡터도 연속적으로 완만하게 조절 (smoothTime 0.65s)
    const vzRef = { val: this._zoomVelocity };
    this._zoom = smoothDamp(this._zoom, this._targetZoom, vzRef, 0.65, 10, dt);
    this._zoomVelocity = vzRef.val;
  }

  private _calcTargetPositionAndZoom(
    marbles: Marble[],
    stage: StageDef,
    needToZoom: boolean,
    targetIndex: number,
    deltaTime: number
  ) {
    if (!this._shouldFollowMarbles) {
      return;
    }

    if (marbles.length > 0) {
      const leadMarble = marbles[targetIndex] ?? marbles[0];
      const targetY = leadMarble.y;

      // 선두 그룹(상위 최대 7개)의 가중 X좌표 계산:
      // 선두와의 거리가 0이면 가중치 1, 3.5 이상이면 0으로 매끄럽게 감소 (C1 연속)
      const topCount = Math.min(7, marbles.length);
      let weightSum = 0;
      let weightedX = 0;

      for (let i = 0; i < topCount; i++) {
        const m = marbles[i];
        const distY = Math.abs(m.y - leadMarble.y);
        if (distY < 3.5) {
          const w = (1 - distY / 3.5) ** 2;
          weightedX += m.x * w;
          weightSum += w;
        }
      }

      const rawTargetX = weightSum > 0 ? weightedX / weightSum : leadMarble.x;
      const rawTargetY = targetY;

      // 1차 저주파 필터 (Low-pass filter): 구슬 간 미세 충돌 진동 제거 (~70ms)
      const alpha = 1 - Math.exp(-deltaTime / 0.07);
      this._filteredTarget.x += (rawTargetX - this._filteredTarget.x) * alpha;
      this._filteredTarget.y += (rawTargetY - this._filteredTarget.y) * alpha;

      this._targetPosition.x = this._filteredTarget.x;
      this._targetPosition.y = this._filteredTarget.y;

      if (needToZoom) {
        const goalDist = Math.abs(stage.zoomY - this._position.y);
        this._targetZoom = Math.max(1, (1 - goalDist / zoomThreshold) * 4);
      } else {
        this._targetZoom = 1;
      }
    } else {
      this._targetZoom = 1;
    }
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
