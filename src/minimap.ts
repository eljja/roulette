import { initialZoom } from './data/constants';
import type { RenderParameters } from './rouletteRenderer';
import type { ColorTheme } from './types/ColorTheme';
import type { MapEntityState } from './types/MapEntity.type';
import type { Rect } from './types/rect.type';
import type { VectorLike } from './types/VectorLike';
import type { UIObject } from './UIObject';
import { bound } from './utils/bound.decorator';
import { getRotationRad } from './utils/utils';

const MINIMAP_SCALE = 4;
const MINIMAP_UNITS = 26;
/** 미니맵은 좌측에 세로로 긴 스트립이다. 다른 HUD가 피해가려면 이 값이 필요하다 */
export const MINIMAP_INSET = 10;
export const MINIMAP_WIDTH = MINIMAP_UNITS * MINIMAP_SCALE;

export class Minimap implements UIObject {
  private ctx!: CanvasRenderingContext2D;
  private lastParams: RenderParameters | null = null;

  private _onViewportChangeHandler: ((pos?: VectorLike) => void) | null = null;
  private boundingBox: Rect;
  private isDragging = false;

  constructor() {
    this.boundingBox = {
      x: MINIMAP_INSET,
      y: MINIMAP_INSET,
      w: MINIMAP_WIDTH,
      h: 0,
    };
  }

  getBoundingBox(): Rect | null {
    return this.boundingBox;
  }

  onViewportChange(callback: (pos?: VectorLike) => void) {
    this._onViewportChangeHandler = callback;
  }

  update(): void {
    // nothing to do
  }

  @bound
  onMouseDown(e?: { x: number; y: number; button?: number }) {
    if (!e) return;
    this.isDragging = true;
    this.mousePosition = {
      x: e.x,
      y: e.y,
    };
    if (this._onViewportChangeHandler) {
      this._onViewportChangeHandler({
        x: this.mousePosition.x / MINIMAP_SCALE,
        y: this.mousePosition.y / MINIMAP_SCALE,
      });
    }
  }

  @bound
  onMouseUp(_e?: { x: number; y: number; button?: number }) {
    if (this.isDragging) {
      this.isDragging = false;
      this.mousePosition = null;
      if (this._onViewportChangeHandler) {
        this._onViewportChangeHandler();
      }
    }
  }

  @bound
  onMouseMove(e?: { x: number; y: number }) {
    if (!this.isDragging) {
      return; // 마우스 클릭(드래그) 상태가 아닐 때는 뷰포트를 이동시키지 않음
    }
    if (!e) {
      this.isDragging = false;
      this.mousePosition = null;
      if (this._onViewportChangeHandler) {
        this._onViewportChangeHandler();
      }
      return;
    }
    if (!this.lastParams) return;
    this.mousePosition = {
      x: e.x,
      y: e.y,
    };
    if (this._onViewportChangeHandler) {
      this._onViewportChangeHandler({
        x: this.mousePosition.x / MINIMAP_SCALE,
        y: this.mousePosition.y / MINIMAP_SCALE,
      });
    }
  }

  render(ctx: CanvasRenderingContext2D, params: RenderParameters) {
    if (!ctx) return;
    const { stage } = params;
    if (!stage) return;
    this.boundingBox.h = stage.goalY * MINIMAP_SCALE;

    this.lastParams = params;

    this.ctx = ctx;
    ctx.save();
    ctx.fillStyle = params.theme.minimapBackground;
    ctx.translate(MINIMAP_INSET, MINIMAP_INSET);
    ctx.scale(MINIMAP_SCALE, MINIMAP_SCALE);
    ctx.fillRect(0, 0, MINIMAP_UNITS, stage.goalY);

    this.ctx.lineWidth = 3 / (params.camera.zoom + initialZoom);
    this.drawEntities(params.entities, params.theme);
    this.drawMarbles(params);
    this.drawViewport(params);

    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'green';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.boundingBox.x, this.boundingBox.y, this.boundingBox.w, this.boundingBox.h);
    ctx.restore();
  }

  private drawViewport(params: RenderParameters) {
    this.ctx.save();
    const { camera, size } = params;
    const zoom = camera.zoom * initialZoom;
    const w = size.x / zoom;
    const h = size.y / zoom;
    this.ctx.strokeStyle = params.theme.minimapViewport;
    this.ctx.lineWidth = 1 / zoom;
    this.ctx.strokeRect(camera.x - w / 2, camera.y - h / 2, w, h);
    this.ctx.restore();
  }

  private drawEntities(entities: MapEntityState[], theme: ColorTheme) {
    this.ctx.save();
    entities.forEach((entity) => {
      this.ctx.save();
      this.ctx.fillStyle = entity.shape.color ?? theme.entity[entity.shape.type].fill;
      this.ctx.strokeStyle = entity.shape.color ?? theme.entity[entity.shape.type].outline;
      this.ctx.translate(entity.x, entity.y);
      this.ctx.rotate(entity.angle);

      this.ctx.save();
      const shape = entity.shape;
      switch (shape.type) {
        case 'box': {
          const w = shape.width * 2;
          const h = shape.height * 2;
          this.ctx.rotate(getRotationRad(shape.rotation));
          this.ctx.fillRect(-w / 2, -h / 2, w, h);
          break;
        }
        case 'circle':
          this.ctx.beginPath();
          this.ctx.arc(0, 0, shape.radius, 0, Math.PI * 2, false);
          this.ctx.stroke();
          break;
        case 'polyline':
          if (shape.points.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(shape.points[0][0], shape.points[0][1]);
            for (let i = 1; i < shape.points.length; i++) {
              this.ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            }
            this.ctx.stroke();
          }
          break;
      }
      this.ctx.restore();
      this.ctx.restore();
    });
    this.ctx.restore();
  }

  private drawMarbles(params: RenderParameters) {
    const { marbles } = params;
    const viewPort = {
      x: params.camera.x,
      y: params.camera.y,
      w: params.size.x,
      h: params.size.y,
      zoom: params.camera.zoom * initialZoom,
    };
    marbles.forEach((marble) => {
      marble.render(this.ctx, 1, false, true, undefined, viewPort, params.theme);
    });
  }
}
