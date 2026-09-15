import type { StageDef } from '../data/maps';
import { Box2dPhysics } from '../physics-box2d';
import type {
  EntityBoxShape,
  EntityCircleShape,
  EntityPolylineShape,
  EntityShape,
  MapEntity,
} from '../types/MapEntity.type';
import type { VectorLike } from '../types/VectorLike';

export interface DragTemplateData {
  shapeType: 'box' | 'circle' | 'polyline';
  entityType: 'static' | 'kinematic';
  label: string;
  defaultShape: EntityShape;
  defaultProps: {
    density: number;
    restitution: number;
    angularVelocity: number;
    life?: number;
  };
}

export type HandleType =
  | 'none'
  | 'body'
  | 'goal'
  | 'vertex'
  | 'circle-radius'
  | 'box-left'
  | 'box-right'
  | 'box-top'
  | 'box-bottom'
  | 'box-rotate'
  | 'spawn-body'
  | 'spawn-left'
  | 'spawn-right'
  | 'spawn-top'
  | 'spawn-bottom';

interface ActiveHandleState {
  type: HandleType;
  vertexIndex?: number;
  startWorld: VectorLike;
  entityStartPos: VectorLike;
  boxStartW: number;
  boxStartH: number;
  boxStartRot: number;
  circleStartR: number;
  spawnStart?: { x: number; y: number; width: number; height: number };
}

export class MapEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  public stage: StageDef;
  public selectedIndex: number | null = null;
  public onSelectionChange?: (entity: MapEntity | null, index: number | null) => void;
  public onStageChange?: (stage: StageDef) => void;
  public onToast?: (message: string) => void;

  // 뷰포트 상태 (월드 좌표)
  public viewX = 13;
  public viewY = 30;
  public zoom = 24; // 1 월드 미터당 24 픽셀

  // 마우스 상태
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private activeHandle: ActiveHandleState | null = null;
  private hoveredHandle: { type: HandleType; vertexIndex?: number } | null = null;

  // 미니맵 설정 (기존 2px/m의 2배인 4px/m, 기존 게임과 동일한 104px 폭)
  private readonly MINIMAP_SCALE = 4;
  private readonly MINIMAP_UNITS = 26;
  private readonly MINIMAP_X = 16;
  private readonly MINIMAP_Y = 16;
  private isMinimapDragging = false;

  // 실행 취소 / 다시 실행 (Undo / Redo)
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly MAX_HISTORY = 40;

  // 복사 / 붙여넣기 (Ctrl+C / Ctrl+V)
  private copiedEntity: MapEntity | null = null;
  public lastMouseWorldPos: VectorLike = { x: 13, y: 10 };

  // 테스트 플레이 상태
  public isTesting = false;
  private isPhysicsReady = false;
  private testPhysics: Box2dPhysics | null = null;
  private testMarbles: { id: number; color: string }[] = [];
  private testAnimFrame = 0;
  private testLastTime = 0;

  private isRunning = false;

  constructor(canvas: HTMLCanvasElement, initialStage?: StageDef) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not supported');
    this.ctx = ctx;

    if (initialStage) {
      this.stage = JSON.parse(JSON.stringify(initialStage));
    } else {
      this.stage = this.createDefaultStage();
    }

    this.bindEvents();
    this.startRenderLoop();
  }

  public createDefaultStage(): StageDef {
    return {
      title: '나만의 커스텀 맵',
      goalY: 90,
      zoomY: 85,
      entities: [
        // 기본 좌우 외곽 가이드 벽
        {
          position: { x: 0, y: 0 },
          type: 'static',
          shape: {
            type: 'polyline',
            rotation: 0,
            points: [
              [16.5, -50],
              [9.25, -50],
              [9.25, 8.5],
              [4, 20],
              [4, 85],
              [12, 90],
            ],
          },
          props: { density: 1, angularVelocity: 0, restitution: 0 },
        },
        {
          position: { x: 0, y: 0 },
          type: 'static',
          shape: {
            type: 'polyline',
            rotation: 0,
            points: [
              [16.5, -50],
              [16.5, 8.5],
              [22, 20],
              [22, 85],
              [14, 90],
            ],
          },
          props: { density: 1, angularVelocity: 0, restitution: 0 },
        },
      ],
    };
  }

  public resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
  }

  public setStage(newStage: StageDef) {
    this.saveHistory();
    this.stage = JSON.parse(JSON.stringify(newStage));
    this.selectedIndex = null;
    this.activeHandle = null;
    this.hoveredHandle = null;
    this.viewY = Math.min(this.stage.goalY / 2, 40);
    this.onSelectionChange?.(null, null);
    this.onStageChange?.(this.stage);
  }

  /** 출발 영역 가져오기 (기본값: 하드코딩 기존 위치) */
  public getSpawnArea() {
    return this.stage.spawnArea ?? { x: 9.25, y: 0, width: 7.25, height: 6 };
  }

  /** 출발 영역 설정 (없으면 생성) */
  private ensureSpawnArea() {
    if (!this.stage.spawnArea) {
      this.stage.spawnArea = { x: 9.25, y: 0, width: 7.25, height: 6 };
    }
    return this.stage.spawnArea;
  }

  // ================= 히스토리 (Undo / Redo) =================
  public saveHistory() {
    const snap = JSON.stringify(this.stage);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snap) {
      return;
    }
    this.undoStack.push(snap);
    if (this.undoStack.length > this.MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  public undo(): boolean {
    if (this.undoStack.length === 0) return false;
    const currentSnap = JSON.stringify(this.stage);
    this.redoStack.push(currentSnap);
    const prevSnap = this.undoStack.pop()!;
    this.stage = JSON.parse(prevSnap);
    if (this.selectedIndex !== null && (!this.stage.entities || this.selectedIndex >= this.stage.entities.length)) {
      this.selectedIndex = null;
    }
    const currentEntity = this.selectedIndex !== null ? (this.stage.entities?.[this.selectedIndex] ?? null) : null;
    this.activeHandle = null;
    this.onSelectionChange?.(currentEntity, this.selectedIndex);
    this.onStageChange?.(this.stage);
    this.onToast?.('↩️ 실행 취소 (Undo)');
    return true;
  }

  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const currentSnap = JSON.stringify(this.stage);
    this.undoStack.push(currentSnap);
    const nextSnap = this.redoStack.pop()!;
    this.stage = JSON.parse(nextSnap);
    if (this.selectedIndex !== null && (!this.stage.entities || this.selectedIndex >= this.stage.entities.length)) {
      this.selectedIndex = null;
    }
    const currentEntity = this.selectedIndex !== null ? (this.stage.entities?.[this.selectedIndex] ?? null) : null;
    this.activeHandle = null;
    this.onSelectionChange?.(currentEntity, this.selectedIndex);
    this.onStageChange?.(this.stage);
    this.onToast?.('↪️ 다시 실행 (Redo)');
    return true;
  }

  // ================= 클립보드 (Ctrl+C / Ctrl+V) =================
  public copySelectedEntity(): boolean {
    if (this.selectedIndex === null || !this.stage.entities?.[this.selectedIndex]) return false;
    this.copiedEntity = JSON.parse(JSON.stringify(this.stage.entities[this.selectedIndex]));
    this.onToast?.('⧉ 아이템이 복사되었습니다 (Ctrl+V로 붙여넣기)');
    return true;
  }

  public pasteEntity(): boolean {
    if (!this.copiedEntity) return false;
    this.saveHistory();
    const cloned: MapEntity = JSON.parse(JSON.stringify(this.copiedEntity));
    // 마우스 위치 기준으로 붙여넣거나, 기존 위치에서 +1 오프셋
    cloned.position.x += 1.0;
    cloned.position.y += 1.0;

    if (!this.stage.entities) {
      this.stage.entities = [];
    }
    this.stage.entities.push(cloned);
    this.selectedIndex = this.stage.entities.length - 1;
    this.activeHandle = null;
    this.onSelectionChange?.(cloned, this.selectedIndex);
    this.onStageChange?.(this.stage);
    this.onToast?.('📋 아이템을 붙여넣었습니다.');
    return true;
  }

  // 월드 <-> 스크린 변환
  public worldToScreen(wx: number, wy: number): VectorLike {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return {
      x: cx + (wx - this.viewX) * this.zoom,
      y: cy + (wy - this.viewY) * this.zoom,
    };
  }

  public screenToWorld(sx: number, sy: number): VectorLike {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    return {
      x: this.viewX + (sx - cx) / this.zoom,
      y: this.viewY + (sy - cy) / this.zoom,
    };
  }

  // ================= 기즈모 핸들 히트테스트 =================
  private hitTestHandle(
    entity: MapEntity,
    wx: number,
    wy: number,
    sx: number,
    sy: number
  ): { type: HandleType; vertexIndex?: number } | null {
    const shape = entity.shape;
    const tolPx = 10;
    const tolWorld = tolPx / this.zoom;

    // 1. Polyline: 각 정점(Vertex) 핸들 검사
    if (shape.type === 'polyline') {
      const poly = shape as EntityPolylineShape;
      for (let i = 0; i < poly.points.length; i++) {
        const p = poly.points[i];
        const ptW = { x: entity.position.x + p[0], y: entity.position.y + p[1] };
        const ptS = this.worldToScreen(ptW.x, ptW.y);
        if (Math.hypot(sx - ptS.x, sy - ptS.y) <= tolPx + 2) {
          return { type: 'vertex', vertexIndex: i };
        }
      }
      return null;
    }

    // 2. Circle: 외곽선 둘레(Circumference) 드래그 핸들 검사
    if (shape.type === 'circle') {
      const circle = shape as EntityCircleShape;
      const cenS = this.worldToScreen(entity.position.x, entity.position.y);
      const rS = circle.radius * this.zoom;
      const distFromCenterS = Math.hypot(sx - cenS.x, sy - cenS.y);

      // 외곽선 반지름 오차 8px 이내
      if (Math.abs(distFromCenterS - rS) <= tolPx) {
        return { type: 'circle-radius' };
      }
      return null;
    }

    // 3. Box: 4방향 에지 핸들 및 회전 핸들 검사
    if (shape.type === 'box') {
      const box = shape as EntityBoxShape;
      const cx = entity.position.x;
      const cy = entity.position.y;
      const rad = (box.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // 마우스 좌표를 상자 로컬 좌표계로 회전 변환
      const dx = wx - cx;
      const dy = wy - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;

      const w = box.width;
      const h = box.height;

      // 회전 핸들: 상단 중앙에서 위쪽으로 0.8m 떨어진 위치
      const rotHandleOffset = h + Math.max(0.8, 16 / this.zoom);
      const rotW = {
        x: cx - rotHandleOffset * Math.sin(rad),
        y: cy - rotHandleOffset * Math.cos(rad),
      };
      const rotS = this.worldToScreen(rotW.x, rotW.y);
      if (Math.hypot(sx - rotS.x, sy - rotS.y) <= tolPx) {
        return { type: 'box-rotate' };
      }

      // 우측 에지 (Right)
      if (Math.abs(lx - w) <= tolWorld && Math.abs(ly) <= h + tolWorld) {
        return { type: 'box-right' };
      }
      // 좌측 에지 (Left)
      if (Math.abs(lx - -w) <= tolWorld && Math.abs(ly) <= h + tolWorld) {
        return { type: 'box-left' };
      }
      // 하단 에지 (Bottom)
      if (Math.abs(ly - h) <= tolWorld && Math.abs(lx) <= w + tolWorld) {
        return { type: 'box-bottom' };
      }
      // 상단 에지 (Top)
      if (Math.abs(ly - -h) <= tolWorld && Math.abs(lx) <= w + tolWorld) {
        return { type: 'box-top' };
      }
    }

    return null;
  }

  // 박스 회전 각도에 따른 마우스 리사이즈 커서 결정
  private getBoxResizeCursor(boxRotation: number, edge: 'left' | 'right' | 'top' | 'bottom'): string {
    let angle = boxRotation;
    if (edge === 'top' || edge === 'bottom') {
      angle += 90;
    }
    const normAngle = ((angle % 180) + 180) % 180;
    if (normAngle >= 22.5 && normAngle < 67.5) return 'nwse-resize';
    if (normAngle >= 67.5 && normAngle < 112.5) return 'ns-resize';
    if (normAngle >= 112.5 && normAngle < 157.5) return 'nesw-resize';
    return 'ew-resize';
  }

  private bindEvents() {
    window.addEventListener('resize', () => this.resize());
    setTimeout(() => this.resize(), 50);

    // 휠 줌
    this.canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const mouseScreen = {
          x: (e.clientX - rect.left) * dpr,
          y: (e.clientY - rect.top) * dpr,
        };
        const mouseWorldBefore = this.screenToWorld(mouseScreen.x, mouseScreen.y);

        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
        this.zoom = Math.max(6, Math.min(80, this.zoom * zoomFactor));

        const mouseWorldAfter = this.screenToWorld(mouseScreen.x, mouseScreen.y);
        this.viewX -= mouseWorldAfter.x - mouseWorldBefore.x;
        this.viewY -= mouseWorldAfter.y - mouseWorldBefore.y;
      },
      { passive: false }
    );

    // 마우스 다운
    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (this.isTesting) return;

      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const sx = (e.clientX - rect.left) * dpr;
      const sy = (e.clientY - rect.top) * dpr;
      const world = this.screenToWorld(sx, sy);

      // 우클릭, 휠클릭, Space키 조합: 뷰 이동(Pan)
      if (e.button === 1 || e.button === 2 || e.shiftKey || e.altKey) {
        e.preventDefault();
        this.isPanning = true;
        this.panStart = { x: sx, y: sy };
        this.canvas.style.cursor = 'grab';
        return;
      }

      if (e.button === 0) {
        // 0. 미니맵 클릭 검사 (뷰포트 이동)
        const goalY = this.stage.goalY;
        const mmScale = Math.min(this.MINIMAP_SCALE, Math.max(2, (this.canvas.height - 40) / Math.max(goalY, 30)));
        const mmW = this.MINIMAP_UNITS * mmScale;
        const mmH = Math.max(80, goalY * mmScale);
        if (sx >= this.MINIMAP_X && sx <= this.MINIMAP_X + mmW && sy >= this.MINIMAP_Y && sy <= this.MINIMAP_Y + mmH) {
          this.isMinimapDragging = true;
          this.viewX = (sx - this.MINIMAP_X) / mmScale;
          this.viewY = (sy - this.MINIMAP_Y) / mmScale;
          return;
        }

        // 1. 현재 선택된 엔티티의 기즈모 핸들 클릭 여부 최우선 검사
        if (this.selectedIndex !== null && this.stage.entities?.[this.selectedIndex]) {
          const selEntity = this.stage.entities[this.selectedIndex];
          const handle = this.hitTestHandle(selEntity, world.x, world.y, sx, sy);

          if (handle) {
            this.saveHistory();
            const bShape = selEntity.shape.type === 'box' ? (selEntity.shape as EntityBoxShape) : null;
            const cShape = selEntity.shape.type === 'circle' ? (selEntity.shape as EntityCircleShape) : null;

            this.activeHandle = {
              type: handle.type,
              vertexIndex: handle.vertexIndex,
              startWorld: { x: world.x, y: world.y },
              entityStartPos: { x: selEntity.position.x, y: selEntity.position.y },
              boxStartW: bShape?.width ?? 0,
              boxStartH: bShape?.height ?? 0,
              boxStartRot: bShape?.rotation ?? 0,
              circleStartR: cShape?.radius ?? 0,
            };
            return;
          }
        }

        // 2. 골 라인 조작 체크
        if (Math.abs(world.y - this.stage.goalY) < 1.0) {
          this.saveHistory();
          this.activeHandle = {
            type: 'goal',
            startWorld: { x: world.x, y: world.y },
            entityStartPos: { x: 0, y: 0 },
            boxStartW: 0,
            boxStartH: 0,
            boxStartRot: 0,
            circleStartR: 0,
          };
          this.canvas.style.cursor = 'ns-resize';
          return;
        }

        // 2.5 출발 영역(Spawn Zone) 히트테스트
        {
          const sp = this.getSpawnArea();
          const tolW = 8 / this.zoom; // 8px 허용 오차를 월드 단위로 변환
          const left = sp.x;
          const right = sp.x + sp.width;
          const top = sp.y;
          const bottom = sp.y + sp.height;
          const inX = world.x >= left - tolW && world.x <= right + tolW;
          const inY = world.y >= top - tolW && world.y <= bottom + tolW;
          const spawnHandleBase = {
            startWorld: { x: world.x, y: world.y },
            entityStartPos: { x: 0, y: 0 },
            boxStartW: 0,
            boxStartH: 0,
            boxStartRot: 0,
            circleStartR: 0,
            spawnStart: { ...sp },
          };

          // 에지 핸들 검사
          if (inY && Math.abs(world.x - left) <= tolW) {
            this.saveHistory();
            this.activeHandle = { ...spawnHandleBase, type: 'spawn-left' };
            this.selectedIndex = null;
            this.onSelectionChange?.(null, null);
            this.canvas.style.cursor = 'ew-resize';
            return;
          }
          if (inY && Math.abs(world.x - right) <= tolW) {
            this.saveHistory();
            this.activeHandle = { ...spawnHandleBase, type: 'spawn-right' };
            this.selectedIndex = null;
            this.onSelectionChange?.(null, null);
            this.canvas.style.cursor = 'ew-resize';
            return;
          }
          if (inX && Math.abs(world.y - top) <= tolW) {
            this.saveHistory();
            this.activeHandle = { ...spawnHandleBase, type: 'spawn-top' };
            this.selectedIndex = null;
            this.onSelectionChange?.(null, null);
            this.canvas.style.cursor = 'ns-resize';
            return;
          }
          if (inX && Math.abs(world.y - bottom) <= tolW) {
            this.saveHistory();
            this.activeHandle = { ...spawnHandleBase, type: 'spawn-bottom' };
            this.selectedIndex = null;
            this.onSelectionChange?.(null, null);
            this.canvas.style.cursor = 'ns-resize';
            return;
          }

          // 영역 내부 클릭: 전체 이동
          if (world.x > left + tolW && world.x < right - tolW && world.y > top + tolW && world.y < bottom - tolW) {
            this.saveHistory();
            this.activeHandle = { ...spawnHandleBase, type: 'spawn-body' };
            this.selectedIndex = null;
            this.onSelectionChange?.(null, null);
            this.canvas.style.cursor = 'move';
            return;
          }
        }

        // 3. 엔티티 클릭 선택 체크 (위에 그려진 것 먼저)
        const entities = this.stage.entities || [];
        let hitIndex: number | null = null;

        for (let i = entities.length - 1; i >= 0; i--) {
          if (this.hitTest(entities[i], world.x, world.y)) {
            hitIndex = i;
            break;
          }
        }

        this.selectedIndex = hitIndex;
        if (hitIndex !== null) {
          let ent = entities[hitIndex];

          // Ctrl + 클릭/드래그: 즉시 복제하여 복제본을 드래그 대상으로 설정
          if (e.ctrlKey || e.metaKey) {
            this.saveHistory();
            const cloned: MapEntity = JSON.parse(JSON.stringify(ent));
            entities.push(cloned);
            hitIndex = entities.length - 1;
            this.selectedIndex = hitIndex;
            ent = cloned;
          } else {
            this.saveHistory();
          }

          const bShape = ent.shape.type === 'box' ? (ent.shape as EntityBoxShape) : null;
          const cShape = ent.shape.type === 'circle' ? (ent.shape as EntityCircleShape) : null;

          this.activeHandle = {
            type: 'body',
            startWorld: { x: world.x, y: world.y },
            entityStartPos: { x: ent.position.x, y: ent.position.y },
            boxStartW: bShape?.width ?? 0,
            boxStartH: bShape?.height ?? 0,
            boxStartRot: bShape?.rotation ?? 0,
            circleStartR: cShape?.radius ?? 0,
          };
          this.onSelectionChange?.(ent, hitIndex);
        } else {
          this.activeHandle = null;
          this.onSelectionChange?.(null, null);
        }
      }
    });

    // 마우스 이동
    window.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const sx = (e.clientX - rect.left) * dpr;
      const sy = (e.clientY - rect.top) * dpr;
      const world = this.screenToWorld(sx, sy);
      this.lastMouseWorldPos = { x: world.x, y: world.y };

      // 뷰 이동(Pan) 중
      if (this.isPanning) {
        const dx = (sx - this.panStart.x) / this.zoom;
        const dy = (sy - this.panStart.y) / this.zoom;
        this.viewX -= dx;
        this.viewY -= dy;
        this.panStart = { x: sx, y: sy };
        return;
      }

      // 미니맵 드래그 중 (뷰포트 추적 이동)
      if (this.isMinimapDragging) {
        const goalY = this.stage.goalY;
        const mmScale = Math.min(this.MINIMAP_SCALE, Math.max(2, (this.canvas.height - 40) / Math.max(goalY, 30)));
        this.viewX = (sx - this.MINIMAP_X) / mmScale;
        this.viewY = (sy - this.MINIMAP_Y) / mmScale;
        return;
      }

      // 미니맵 영역 마우스 호버 커서
      const goalY = this.stage.goalY;
      const mmScale = Math.min(this.MINIMAP_SCALE, Math.max(2, (this.canvas.height - 40) / Math.max(goalY, 30)));
      const mmW = this.MINIMAP_UNITS * mmScale;
      const mmH = Math.max(80, goalY * mmScale);
      if (sx >= this.MINIMAP_X && sx <= this.MINIMAP_X + mmW && sy >= this.MINIMAP_Y && sy <= this.MINIMAP_Y + mmH) {
        this.canvas.style.cursor = 'pointer';
        return;
      }

      // 아무것도 드래그하지 않을 때 커서 모양 피드백
      if (!this.activeHandle) {
        let newCursor = '';

        if (this.selectedIndex !== null && this.stage.entities?.[this.selectedIndex]) {
          const selEntity = this.stage.entities[this.selectedIndex];
          const handle = this.hitTestHandle(selEntity, world.x, world.y, sx, sy);
          this.hoveredHandle = handle;

          if (handle) {
            switch (handle.type) {
              case 'vertex':
                newCursor = 'crosshair';
                break;
              case 'circle-radius':
                newCursor = 'nwse-resize';
                break;
              case 'box-rotate':
                newCursor = 'grab';
                break;
              case 'box-left':
              case 'box-right':
              case 'box-top':
              case 'box-bottom': {
                const rot = (selEntity.shape as EntityBoxShape).rotation || 0;
                const edge = handle.type.replace('box-', '') as 'left' | 'right' | 'top' | 'bottom';
                newCursor = this.getBoxResizeCursor(rot, edge);
                break;
              }
            }
          }
        }

        if (!newCursor) {
          if (Math.abs(world.y - this.stage.goalY) < 1.0) {
            newCursor = 'ns-resize';
          } else {
            // 출발 영역 커서 피드백
            const sp = this.getSpawnArea();
            const tolW = 8 / this.zoom;
            const left = sp.x;
            const right = sp.x + sp.width;
            const top = sp.y;
            const bottom = sp.y + sp.height;
            const inX = world.x >= left - tolW && world.x <= right + tolW;
            const inY = world.y >= top - tolW && world.y <= bottom + tolW;

            if (inY && (Math.abs(world.x - left) <= tolW || Math.abs(world.x - right) <= tolW)) {
              newCursor = 'ew-resize';
            } else if (inX && (Math.abs(world.y - top) <= tolW || Math.abs(world.y - bottom) <= tolW)) {
              newCursor = 'ns-resize';
            } else if (
              world.x > left + tolW &&
              world.x < right - tolW &&
              world.y > top + tolW &&
              world.y < bottom - tolW
            ) {
              newCursor = 'move';
            } else {
              const entities = this.stage.entities || [];
              for (let i = entities.length - 1; i >= 0; i--) {
                if (this.hitTest(entities[i], world.x, world.y)) {
                  newCursor = 'move';
                  break;
                }
              }
            }
          }
        }

        this.canvas.style.cursor = newCursor;
        return;
      }

      // 기즈모 조작 처리
      const handle = this.activeHandle;

      if (handle.type === 'goal') {
        const newGoalY = Math.max(20, Math.round(world.y * 2) / 2);
        this.stage.goalY = newGoalY;
        this.stage.zoomY = Math.max(15, newGoalY - 5);
        this.onStageChange?.(this.stage);
        return;
      }

      // 출발 영역(Spawn Zone) 드래그 처리
      if (handle.type.startsWith('spawn-') && handle.spawnStart) {
        const sp = this.ensureSpawnArea();
        const s = handle.spawnStart;
        const dx = world.x - handle.startWorld.x;
        const dy = world.y - handle.startWorld.y;

        if (handle.type === 'spawn-body') {
          let dx = world.x - handle.startWorld.x;
          let dy = world.y - handle.startWorld.y;

          // Shift 키: X축 또는 Y축 단일 방향으로만 이동 제한
          if (e.shiftKey) {
            if (Math.abs(dx) >= Math.abs(dy)) {
              dy = 0;
            } else {
              dx = 0;
            }
          }

          sp.x = Math.round((s.x + dx) * 4) / 4;
          sp.y = Math.round((s.y + dy) * 4) / 4;
        } else if (handle.type === 'spawn-left') {
          const newLeft = Math.round((s.x + dx) * 4) / 4;
          const maxLeft = s.x + s.width - 1;
          sp.x = Math.min(newLeft, maxLeft);
          sp.width = s.width - (sp.x - s.x);
        } else if (handle.type === 'spawn-right') {
          sp.width = Math.max(1, Math.round((s.width + dx) * 4) / 4);
        } else if (handle.type === 'spawn-top') {
          const newTop = Math.round((s.y + dy) * 4) / 4;
          const maxTop = s.y + s.height - 1;
          sp.y = Math.min(newTop, maxTop);
          sp.height = s.height - (sp.y - s.y);
        } else if (handle.type === 'spawn-bottom') {
          sp.height = Math.max(1, Math.round((s.height + dy) * 4) / 4);
        }
        this.onStageChange?.(this.stage);
        return;
      }

      if (this.selectedIndex === null || !this.stage.entities?.[this.selectedIndex]) return;
      const entity = this.stage.entities[this.selectedIndex];
      const shape = entity.shape;

      // 1. Polyline 정점(Point) 드래그 위치 변경
      if (handle.type === 'vertex' && handle.vertexIndex !== undefined && shape.type === 'polyline') {
        const poly = shape as EntityPolylineShape;
        if (poly.points[handle.vertexIndex]) {
          let targetWx = world.x;
          let targetWy = world.y;

          // Shift 키: X축 또는 Y축 단일 방향으로만 정점 이동 제한
          if (e.shiftKey) {
            const dx = world.x - handle.startWorld.x;
            const dy = world.y - handle.startWorld.y;
            if (Math.abs(dx) >= Math.abs(dy)) {
              targetWy = handle.startWorld.y;
            } else {
              targetWx = handle.startWorld.x;
            }
          }

          // 0.25 단위 좌표 스냅
          const snapWx = Math.round(targetWx * 4) / 4;
          const snapWy = Math.round(targetWy * 4) / 4;
          poly.points[handle.vertexIndex][0] = snapWx - entity.position.x;
          poly.points[handle.vertexIndex][1] = snapWy - entity.position.y;
          this.onSelectionChange?.(entity, this.selectedIndex);
          this.onStageChange?.(this.stage);
        }
        return;
      }

      // 2. Circle 외곽선 드래그 (중심 고정 반지름 변경)
      if (handle.type === 'circle-radius' && shape.type === 'circle') {
        const circle = shape as EntityCircleShape;
        const dist = Math.hypot(world.x - entity.position.x, world.y - entity.position.y);
        // 0.05 단위 반지름 스냅 (최소 0.1m)
        circle.radius = Math.max(0.1, Math.round(dist * 20) / 20);
        this.onSelectionChange?.(entity, this.selectedIndex);
        this.onStageChange?.(this.stage);
        return;
      }

      // 3. Box 크기 조절 (회전 막대는 중심 고정 대칭 조절, 고정핀/안내벽은 4방향 조절)
      if (
        (handle.type === 'box-left' ||
          handle.type === 'box-right' ||
          handle.type === 'box-top' ||
          handle.type === 'box-bottom') &&
        shape.type === 'box'
      ) {
        const box = shape as EntityBoxShape;
        const isKinematic = entity.type === 'kinematic'; // 회전 막대
        const rad = (box.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // 마우스 월드 위치를 상자 시작 중심 기준 로컬 좌표로 변환
        const dx = world.x - handle.entityStartPos.x;
        const dy = world.y - handle.entityStartPos.y;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;

        if (isKinematic) {
          // 회전 막대: 중심 엄격 고정, 좌우/상하 대칭 크기 조절
          if (handle.type === 'box-left' || handle.type === 'box-right') {
            box.width = Math.max(0.1, Math.round(Math.abs(lx) * 20) / 20);
          } else {
            box.height = Math.max(0.025, Math.round(Math.abs(ly) * 40) / 40);
          }
        } else {
          // 고정 핀 / 안내 벽: 4방향 각각 조절 (반대쪽 에지는 고정 유지)
          if (handle.type === 'box-right') {
            const w0 = handle.boxStartW;
            const newHalfW = Math.max(0.05, (lx - -w0) / 2);
            const deltaCenter = (lx - w0) / 2;
            entity.position.x = handle.entityStartPos.x + deltaCenter * cos;
            entity.position.y = handle.entityStartPos.y + deltaCenter * sin;
            box.width = Math.round(newHalfW * 20) / 20;
          } else if (handle.type === 'box-left') {
            const w0 = handle.boxStartW;
            const newHalfW = Math.max(0.05, (w0 - lx) / 2);
            const deltaCenter = (lx - -w0) / 2;
            entity.position.x = handle.entityStartPos.x + deltaCenter * cos;
            entity.position.y = handle.entityStartPos.y + deltaCenter * sin;
            box.width = Math.round(newHalfW * 20) / 20;
          } else if (handle.type === 'box-bottom') {
            const h0 = handle.boxStartH;
            const newHalfH = Math.max(0.025, (ly - -h0) / 2);
            const deltaCenter = (ly - h0) / 2;
            entity.position.x = handle.entityStartPos.x - deltaCenter * sin;
            entity.position.y = handle.entityStartPos.y + deltaCenter * cos;
            box.height = Math.round(newHalfH * 40) / 40;
          } else if (handle.type === 'box-top') {
            const h0 = handle.boxStartH;
            const newHalfH = Math.max(0.025, (h0 - ly) / 2);
            const deltaCenter = (ly - -h0) / 2;
            entity.position.x = handle.entityStartPos.x - deltaCenter * sin;
            entity.position.y = handle.entityStartPos.y + deltaCenter * cos;
            box.height = Math.round(newHalfH * 40) / 40;
          }
        }

        this.onSelectionChange?.(entity, this.selectedIndex);
        this.onStageChange?.(this.stage);
        return;
      }

      // 4. Box 회전 핸들 드래그
      if (handle.type === 'box-rotate' && shape.type === 'box') {
        const box = shape as EntityBoxShape;
        const dx = world.x - entity.position.x;
        const dy = world.y - entity.position.y;
        const rotRad = Math.atan2(dy, dx) + Math.PI / 2;
        let rotDeg = (rotRad * 180) / Math.PI;
        rotDeg = ((rotDeg % 360) + 360) % 360;

        // Shift 키가 안 눌려 있으면 5도 단위 스냅
        if (!e.shiftKey) {
          rotDeg = Math.round(rotDeg / 5) * 5;
        }

        box.rotation = rotDeg;
        this.onSelectionChange?.(entity, this.selectedIndex);
        this.onStageChange?.(this.stage);
        return;
      }

      // 5. 전체 엔티티 이동 (Body Drag)
      if (handle.type === 'body') {
        let dx = world.x - handle.startWorld.x;
        let dy = world.y - handle.startWorld.y;

        // Shift 키: X축 또는 Y축 단일 방향으로만 이동 제한
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            dy = 0;
          } else {
            dx = 0;
          }
        }

        let nx = handle.entityStartPos.x + dx;
        let ny = handle.entityStartPos.y + dy;
        nx = Math.round(nx * 4) / 4;
        ny = Math.round(ny * 4) / 4;

        entity.position.x = nx;
        entity.position.y = ny;
        this.onSelectionChange?.(entity, this.selectedIndex);
        this.onStageChange?.(this.stage);
      }
    });

    // 마우스 업
    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.isMinimapDragging = false;
      this.activeHandle = null;
      this.canvas.style.cursor = '';
    });

    // 더블 클릭: Polyline 정점 추가 및 삭제
    this.canvas.addEventListener('dblclick', (e: MouseEvent) => {
      if (this.selectedIndex === null || !this.stage.entities?.[this.selectedIndex]) return;
      const entity = this.stage.entities[this.selectedIndex];
      if (entity.shape.type !== 'polyline') return;

      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const sx = (e.clientX - rect.left) * dpr;
      const sy = (e.clientY - rect.top) * dpr;
      const world = this.screenToWorld(sx, sy);
      const poly = entity.shape as EntityPolylineShape;

      // 1. 기존 정점 위에서 더블클릭 시: 해당 정점 삭제 (최소 2개 유지)
      for (let i = 0; i < poly.points.length; i++) {
        const p = poly.points[i];
        const ptS = this.worldToScreen(entity.position.x + p[0], entity.position.y + p[1]);
        if (Math.hypot(sx - ptS.x, sy - ptS.y) <= 12) {
          if (poly.points.length > 2) {
            this.saveHistory();
            poly.points.splice(i, 1);
            this.onSelectionChange?.(entity, this.selectedIndex);
            this.onStageChange?.(this.stage);
          }
          return;
        }
      }

      // 2. 선분 위에서 더블클릭 시: 해당 위치에 새 정점 삽입
      for (let i = 0; i < poly.points.length - 1; i++) {
        const p1 = poly.points[i];
        const p2 = poly.points[i + 1];
        const w1 = { x: entity.position.x + p1[0], y: entity.position.y + p1[1] };
        const w2 = { x: entity.position.x + p2[0], y: entity.position.y + p2[1] };

        const distToSegment = this.distancePointToSegment(world, w1, w2);
        if (distToSegment <= 0.8) {
          this.saveHistory();
          const snapWx = Math.round(world.x * 4) / 4;
          const snapWy = Math.round(world.y * 4) / 4;
          poly.points.splice(i + 1, 0, [snapWx - entity.position.x, snapWy - entity.position.y]);
          this.onSelectionChange?.(entity, this.selectedIndex);
          this.onStageChange?.(this.stage);
          return;
        }
      }
    });

    // 컨텍스트 메뉴 방지
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 드래그 앤 드롭 (팔레트에서 캔버스로)
    this.canvas.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    this.canvas.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      const rawData = e.dataTransfer?.getData('application/json');
      if (!rawData) return;

      try {
        const template = JSON.parse(rawData) as DragTemplateData;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const sx = (e.clientX - rect.left) * dpr;
        const sy = (e.clientY - rect.top) * dpr;
        const world = this.screenToWorld(sx, sy);

        const snapX = Math.round(world.x * 2) / 2;
        const snapY = Math.round(world.y * 2) / 2;

        const newEntity: MapEntity = {
          position: { x: snapX, y: snapY },
          type: template.entityType,
          shape: JSON.parse(JSON.stringify(template.defaultShape)),
          props: JSON.parse(JSON.stringify(template.defaultProps)),
        };

        this.saveHistory();
        if (!this.stage.entities) {
          this.stage.entities = [];
        }

        this.stage.entities.push(newEntity);
        this.selectedIndex = this.stage.entities.length - 1;
        this.onSelectionChange?.(newEntity, this.selectedIndex);
        this.onStageChange?.(this.stage);
      } catch (err) {
        console.error('Failed to drop entity:', err);
      }
    });

    // 키보드 단축키
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.isTesting) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // Ctrl + Z: 실행 취소 (Undo)
      if (isCtrlOrMeta && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
        return;
      }

      // Ctrl + Y 또는 Ctrl + Shift + Z: 다시 실행 (Redo)
      if (
        (isCtrlOrMeta && e.key.toLowerCase() === 'y') ||
        (isCtrlOrMeta && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        this.redo();
        return;
      }

      // Ctrl + C: 선택 아이템 복사
      if (isCtrlOrMeta && e.key.toLowerCase() === 'c' && this.selectedIndex !== null) {
        e.preventDefault();
        this.copySelectedEntity();
        return;
      }

      // Ctrl + V: 아이템 붙여넣기
      if (isCtrlOrMeta && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pasteEntity();
        return;
      }

      // Delete / Backspace: 아이템 삭제
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIndex !== null) {
        e.preventDefault();
        this.deleteSelectedEntity();
        return;
      }

      // Ctrl + D: 아이템 복제
      if (isCtrlOrMeta && e.key.toLowerCase() === 'd' && this.selectedIndex !== null) {
        e.preventDefault();
        this.duplicateSelectedEntity();
        return;
      }
    });
  }

  private distancePointToSegment(p: VectorLike, a: VectorLike, b: VectorLike): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq === 0) return Math.hypot(apx, apy);
    let t = (apx * abx + apy * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * abx;
    const projY = a.y + t * aby;
    return Math.hypot(p.x - projX, p.y - projY);
  }

  public deleteSelectedEntity() {
    if (this.selectedIndex === null || !this.stage.entities) return;
    this.saveHistory();
    this.stage.entities.splice(this.selectedIndex, 1);
    this.selectedIndex = null;
    this.activeHandle = null;
    this.onSelectionChange?.(null, null);
    this.onStageChange?.(this.stage);
    this.onToast?.('🗑️ 아이템이 삭제되었습니다.');
  }

  public duplicateSelectedEntity() {
    if (this.selectedIndex === null || !this.stage.entities) return;
    this.saveHistory();
    const original = this.stage.entities[this.selectedIndex];
    const clone: MapEntity = JSON.parse(JSON.stringify(original));
    clone.position.x += 1;
    clone.position.y += 1;
    this.stage.entities.push(clone);
    this.selectedIndex = this.stage.entities.length - 1;
    this.activeHandle = null;
    this.onSelectionChange?.(clone, this.selectedIndex);
    this.onStageChange?.(this.stage);
    this.onToast?.('⧉ 아이템이 복제되었습니다.');
  }

  private hitTest(entity: MapEntity, wx: number, wy: number): boolean {
    const dx = wx - entity.position.x;
    const dy = wy - entity.position.y;
    const shape = entity.shape;

    if (shape.type === 'box') {
      const rad = (shape.rotation * Math.PI) / 180;
      const cos = Math.cos(-rad);
      const sin = Math.sin(-rad);
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;
      return Math.abs(localX) <= Math.max(shape.width, 0.4) && Math.abs(localY) <= Math.max(shape.height, 0.4);
    }
    if (shape.type === 'circle') {
      const distSq = dx * dx + dy * dy;
      const r = Math.max(shape.radius, 0.4);
      return distSq <= r * r;
    }
    if (shape.type === 'polyline') {
      for (const p of shape.points) {
        const pdx = wx - (entity.position.x + p[0]);
        const pdy = wy - (entity.position.y + p[1]);
        if (pdx * pdx + pdy * pdy <= 0.8 * 0.8) return true;
      }
    }
    return false;
  }

  // ================= 테스트 플레이 기능 =================
  public async startTestPlay() {
    if (this.isTesting) return;
    this.isPhysicsReady = false;
    this.isTesting = true;
    this.selectedIndex = null;
    this.activeHandle = null;
    this.onSelectionChange?.(null, null);

    try {
      const physics = new Box2dPhysics();
      await physics.init();
      physics.createStage(this.stage);

      // 출발 영역 기반 구슬 배치
      const sp = this.getSpawnArea();
      const cols = 4;
      const rows = 3;
      const marginX = sp.width * 0.15;
      const marginY = sp.height * 0.15;
      const spacingX = (sp.width - marginX * 2) / Math.max(cols - 1, 1);
      const spacingY = (sp.height - marginY * 2) / Math.max(rows - 1, 1);

      this.testMarbles = [];
      for (let i = 0; i < cols * rows; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = sp.x + marginX + col * spacingX;
        const y = sp.y + marginY + row * spacingY;
        const color = `hsl(${(i * 30) % 360}, 100%, 70%)`;
        physics.createMarble(i, x, y);
        this.testMarbles.push({ id: i, color });
      }

      physics.start();
      this.testPhysics = physics;
      this.testLastTime = performance.now();
      this.isPhysicsReady = true;
    } catch (err) {
      this.stopTestPlay();
      throw err;
    }
  }

  public stopTestPlay() {
    this.isTesting = false;
    this.isPhysicsReady = false;
    if (this.testPhysics) {
      this.testPhysics.clearMarbles();
      this.testPhysics.clear();
      this.testPhysics = null;
    }
    this.testMarbles = [];
  }

  // ================= 렌더링 루프 =================
  private startRenderLoop() {
    this.isRunning = true;
    const render = (time: number) => {
      if (!this.isRunning) return;

      if (this.isTesting && this.isPhysicsReady && this.testPhysics) {
        if (!this.testLastTime) this.testLastTime = time;
        const dt = Math.min(time - this.testLastTime, 50);
        this.testLastTime = time;
        const subSteps = 2;
        const subStepSec = dt / 1000 / subSteps;
        try {
          for (let i = 0; i < subSteps; i++) {
            this.testPhysics.step(subStepSec);
          }
        } catch (err) {
          console.error('Physics step error:', err);
        }
      }

      this.draw();
      this.testAnimFrame = requestAnimationFrame(render);
    };
    this.testAnimFrame = requestAnimationFrame(render);
  }

  public destroy() {
    this.isRunning = false;
    cancelAnimationFrame(this.testAnimFrame);
    this.stopTestPlay();
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#181a1b';
    ctx.fillRect(0, 0, w, h);

    this.drawGrid();
    this.drawSpawnArea();
    this.drawGoalLine();
    this.drawEntities();

    // 선택된 엔티티 기즈모 핸들 렌더링
    if (!this.isTesting && this.selectedIndex !== null && this.stage.entities?.[this.selectedIndex]) {
      this.drawGizmo(this.stage.entities[this.selectedIndex]);
    }

    if (this.isTesting && this.testPhysics) {
      this.drawTestMarbles();
    }

    this.drawMinimap();
  }

  private drawGrid() {
    const ctx = this.ctx;
    const minWorld = this.screenToWorld(0, 0);
    const maxWorld = this.screenToWorld(this.canvas.width, this.canvas.height);

    const startX = Math.floor(minWorld.x);
    const endX = Math.ceil(maxWorld.x);
    const startY = Math.floor(minWorld.y);
    const endY = Math.ceil(maxWorld.y);

    ctx.save();
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let x = startX; x <= endX; x++) {
      const screenX = this.worldToScreen(x, 0).x;
      const isMajor = x % 5 === 0;

      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = isMajor ? 1.5 : 1;

      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, this.canvas.height);
      ctx.stroke();

      if (isMajor && this.zoom >= 12) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillText(`${x}`, screenX + 4, 4);
      }
    }

    for (let y = startY; y <= endY; y++) {
      const screenY = this.worldToScreen(0, y).y;
      const isMajor = y % 5 === 0;

      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = isMajor ? 1.5 : 1;

      ctx.beginPath();
      ctx.moveTo(0, screenY);
      ctx.lineTo(this.canvas.width, screenY);
      ctx.stroke();

      if (isMajor && this.zoom >= 12) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillText(`Y:${y}`, 4, screenY + 4);
      }
    }
    ctx.restore();
  }

  private drawSpawnArea() {
    const ctx = this.ctx;
    const sp = this.getSpawnArea();
    const p1 = this.worldToScreen(sp.x, sp.y);
    const p2 = this.worldToScreen(sp.x + sp.width, sp.y + sp.height);
    const w = p2.x - p1.x;
    const h = p2.y - p1.y;

    const isDraggingSpawn = this.activeHandle?.type?.startsWith('spawn-') ?? false;

    ctx.save();
    ctx.fillStyle = isDraggingSpawn ? 'rgba(0, 255, 200, 0.08)' : 'rgba(0, 255, 200, 0.04)';
    ctx.fillRect(p1.x, p1.y, w, h);

    ctx.strokeStyle = isDraggingSpawn ? 'rgba(0, 255, 200, 0.8)' : 'rgba(0, 255, 200, 0.4)';
    ctx.lineWidth = isDraggingSpawn ? 2.5 : 1.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(p1.x, p1.y, w, h);
    ctx.setLineDash([]);

    // 4방향 에지 핸들 (리사이즈 표시)
    const handleLen = Math.min(16, w * 0.3, h * 0.3);
    ctx.fillStyle = isDraggingSpawn ? '#00ffcc' : 'rgba(0, 255, 200, 0.7)';
    // Left
    ctx.fillRect(p1.x - 3, p1.y + h / 2 - handleLen / 2, 6, handleLen);
    // Right
    ctx.fillRect(p2.x - 3, p1.y + h / 2 - handleLen / 2, 6, handleLen);
    // Top
    ctx.fillRect(p1.x + w / 2 - handleLen / 2, p1.y - 3, handleLen, 6);
    // Bottom
    ctx.fillRect(p1.x + w / 2 - handleLen / 2, p2.y - 3, handleLen, 6);

    ctx.fillStyle = 'rgba(0, 255, 200, 0.8)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`▼ 구슬 출발 영역 (${sp.width.toFixed(1)} × ${sp.height.toFixed(1)})`, p1.x + 8, p1.y + 8);
    ctx.restore();
  }

  private drawGoalLine() {
    const ctx = this.ctx;
    const goalY = this.stage.goalY;
    const sy = this.worldToScreen(0, goalY).y;

    ctx.save();
    const boxSize = 14;
    for (let x = 0; x < this.canvas.width; x += boxSize * 2) {
      ctx.fillStyle = 'rgba(255, 215, 0, 0.6)';
      ctx.fillRect(x, sy - 4, boxSize, 8);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x + boxSize, sy - 4, boxSize, 8);
    }

    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, sy - 4);
    ctx.lineTo(this.canvas.width, sy - 4);
    ctx.moveTo(0, sy + 4);
    ctx.lineTo(this.canvas.width, sy + 4);
    ctx.stroke();

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`🏁 GOAL LINE (Y: ${goalY}) - 드래그하여 조절`, 12, sy - 10);
    ctx.restore();
  }

  private drawEntities() {
    const ctx = this.ctx;
    const entities = this.stage.entities || [];

    entities.forEach((entity, index) => {
      const isSelected = this.selectedIndex === index;
      const sp = this.worldToScreen(entity.position.x, entity.position.y);
      const shape = entity.shape;

      ctx.save();
      ctx.translate(sp.x, sp.y);

      switch (shape.type) {
        case 'box': {
          const w = shape.width * 2 * this.zoom;
          const h = shape.height * 2 * this.zoom;
          let rad = (shape.rotation * Math.PI) / 180;
          if (this.isTesting && this.isPhysicsReady && this.testPhysics && entity.type === 'kinematic') {
            const physEntities = this.testPhysics.getEntities();
            if (physEntities[index]) {
              rad = physEntities[index].angle;
            }
          }
          ctx.rotate(rad);

          const isKinematic = entity.type === 'kinematic';
          ctx.fillStyle = isKinematic ? '#226f92' : '#1b5e7d';
          ctx.strokeStyle = isSelected ? '#ffffff' : isKinematic ? '#4dd0e1' : '#00bcd4';
          ctx.lineWidth = isSelected ? 2.5 : 1.5;

          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeRect(-w / 2, -h / 2, w, h);

          // 회전 막대 중심 피벗 핀
          if (isKinematic) {
            ctx.fillStyle = '#ffeb3b';
            ctx.beginPath();
            ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
            ctx.fill();

            const vel = entity.props.angularVelocity || 0;
            ctx.font = '10px sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillText(`${vel > 0 ? '↻' : '↺'} ${vel.toFixed(1)}`, -w / 2, -h / 2 - 4);
          }
          break;
        }
        case 'circle': {
          const r = shape.radius * this.zoom;
          const isBouncy = (entity.props.restitution || 0) > 1.0;

          ctx.fillStyle = isBouncy ? 'rgba(255, 235, 59, 0.3)' : 'rgba(255, 193, 7, 0.2)';
          ctx.strokeStyle = isSelected ? '#ffffff' : isBouncy ? '#ffd54f' : '#ffb300';
          ctx.lineWidth = isSelected ? 2.5 : 1.5;

          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          if (entity.props.life && entity.props.life > 0) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${entity.props.life}`, 0, 0);
          }
          break;
        }
        case 'polyline': {
          const rad = (shape.rotation * Math.PI) / 180;
          ctx.rotate(rad);
          ctx.strokeStyle = isSelected ? '#ffffff' : '#e0e0e0';
          ctx.lineWidth = isSelected ? 3 : 2;

          if (shape.points.length > 0) {
            ctx.beginPath();
            const first = shape.points[0];
            ctx.moveTo(first[0] * this.zoom, first[1] * this.zoom);
            for (let i = 1; i < shape.points.length; i++) {
              const pt = shape.points[i];
              ctx.lineTo(pt[0] * this.zoom, pt[1] * this.zoom);
            }
            ctx.stroke();
          }
          break;
        }
      }

      ctx.restore();
    });
  }

  // ================= 기즈모(Gizmo) 상세 렌더링 =================
  private drawGizmo(entity: MapEntity) {
    const ctx = this.ctx;
    const shape = entity.shape;
    const sp = this.worldToScreen(entity.position.x, entity.position.y);

    ctx.save();

    // 1. Polyline: 각 정점에 드래그 가능한 컨트롤 포인트 핸들 표시
    if (shape.type === 'polyline') {
      const poly = shape as EntityPolylineShape;
      poly.points.forEach((p, i) => {
        const ptW = { x: entity.position.x + p[0], y: entity.position.y + p[1] };
        const ptS = this.worldToScreen(ptW.x, ptW.y);
        const isHovered = this.hoveredHandle?.type === 'vertex' && this.hoveredHandle.vertexIndex === i;
        const isDragging = this.activeHandle?.type === 'vertex' && this.activeHandle.vertexIndex === i;

        ctx.save();
        ctx.beginPath();
        const r = isHovered || isDragging ? 8 : 6;
        ctx.arc(ptS.x, ptS.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isDragging ? '#ffeb3b' : isHovered ? '#00ffff' : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#00838f';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 정점 번호 라벨 표시
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#00e5ff';
        ctx.fillText(`#${i + 1}`, ptS.x + 8, ptS.y - 8);
        ctx.restore();
      });
    }

    // 2. Circle: 외곽선 점선 링 + 4방향 둘레 리사이즈 핸들 (중심 고정 반지름 조절)
    else if (shape.type === 'circle') {
      const circle = shape as EntityCircleShape;
      const rS = circle.radius * this.zoom;
      const isRadiusHovered = this.hoveredHandle?.type === 'circle-radius';
      const isRadiusDragging = this.activeHandle?.type === 'circle-radius';

      ctx.save();
      ctx.translate(sp.x, sp.y);

      // 외곽선 강조 점선 링
      ctx.beginPath();
      ctx.arc(0, 0, rS, 0, Math.PI * 2);
      ctx.strokeStyle = isRadiusHovered || isRadiusDragging ? '#00ffff' : 'rgba(0, 229, 255, 0.6)';
      ctx.lineWidth = isRadiusHovered || isRadiusDragging ? 2.5 : 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();

      // 둘레 4방향 핸들 (East, West, South, North)
      const compassAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      compassAngles.forEach((ang) => {
        const hx = rS * Math.cos(ang);
        const hy = rS * Math.sin(ang);
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fillStyle = isRadiusHovered || isRadiusDragging ? '#ffeb3b' : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#00838f';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // 중심 고정 안내 라벨
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#ffd54f';
      ctx.textAlign = 'center';
      ctx.fillText(`R: ${circle.radius.toFixed(2)}m (외곽선 드래그)`, 0, -rS - 10);
      ctx.restore();
    }

    // 3. Box: 4방향 에지 핸들 + 회전 핸들 + 회전 막대 중심축 안내
    else if (shape.type === 'box') {
      const box = shape as EntityBoxShape;
      const w = box.width * this.zoom; // 반너비
      const h = box.height * this.zoom; // 반높이
      const rad = (box.rotation * Math.PI) / 180;
      const isKinematic = entity.type === 'kinematic';

      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(rad);

      // 점선 선택 박스
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-w, -h, w * 2, h * 2);
      ctx.setLineDash([]);

      // 4방향 에지 핸들 그리기 헬퍼
      const drawEdgeHandle = (hx: number, hy: number, hw: number, hh: number, type: HandleType) => {
        const isHovered = this.hoveredHandle?.type === type;
        const isDragging = this.activeHandle?.type === type;

        ctx.fillStyle = isDragging ? '#ffeb3b' : isHovered ? '#00ffff' : '#ffffff';
        ctx.fillRect(hx - hw / 2, hy - hh / 2, hw, hh);
        ctx.strokeStyle = '#00838f';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hx - hw / 2, hy - hh / 2, hw, hh);
      };

      // 우측 에지 핸들 (Right)
      drawEdgeHandle(w, 0, 7, Math.min(18, h * 1.5), 'box-right');
      // 좌측 에지 핸들 (Left)
      drawEdgeHandle(-w, 0, 7, Math.min(18, h * 1.5), 'box-left');
      // 하단 에지 핸들 (Bottom)
      drawEdgeHandle(0, h, Math.min(18, w * 1.5), 7, 'box-bottom');
      // 상단 에지 핸들 (Top)
      drawEdgeHandle(0, -h, Math.min(18, w * 1.5), 7, 'box-top');

      // 상단 회전 연결 줄 및 회전 핸들
      const rotStemLen = Math.max(22, 0.8 * this.zoom);
      ctx.beginPath();
      ctx.moveTo(0, -h);
      ctx.lineTo(0, -h - rotStemLen);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const isRotHovered = this.hoveredHandle?.type === 'box-rotate';
      const isRotDragging = this.activeHandle?.type === 'box-rotate';
      ctx.beginPath();
      ctx.arc(0, -h - rotStemLen, isRotHovered || isRotDragging ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = isRotDragging ? '#ffeb3b' : isRotHovered ? '#00ffff' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#00838f';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 중심 고정 안내 (회전 막대일 때)
      if (isKinematic) {
        ctx.fillStyle = '#ffeb3b';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⤹⤸ 중심 고정 대칭 조절', 0, h + 15);
      }

      ctx.restore();
    }

    ctx.restore();
  }

  private drawTestMarbles() {
    if (!this.testPhysics) return;
    const ctx = this.ctx;

    this.testMarbles.forEach((m) => {
      const pos = this.testPhysics!.getMarblePosition(m.id);
      if (!pos) return;
      const sp = this.worldToScreen(pos.x, pos.y);
      const r = 0.25 * this.zoom;

      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(pos.angle);

      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    });
  }

  // ================= 전체 지도 미니맵 (104px 폭, 게임과 동일한 4px/m) =================
  private drawMinimap() {
    const ctx = this.ctx;
    const goalY = this.stage.goalY;
    const scale = Math.min(this.MINIMAP_SCALE, Math.max(2, (this.canvas.height - 40) / Math.max(goalY, 30)));
    const mmW = this.MINIMAP_UNITS * scale; // 26 * 4 = 104px
    const mmH = Math.max(80, goalY * scale);
    const mx = this.MINIMAP_X;
    const my = this.MINIMAP_Y;

    ctx.save();
    // 1. 미니맵 배경
    ctx.fillStyle = 'rgba(15, 18, 22, 0.88)';
    ctx.fillRect(mx, my, mmW, mmH);

    // 2. 미니맵 테두리 (게임 스타일)
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mmW, mmH);

    // 라벨
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MINIMAP', mx + mmW / 2, my - 4);

    // 미니맵 영역 클리핑
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx, my, mmW, mmH);
    ctx.clip();

    ctx.translate(mx, my);
    ctx.scale(scale, scale);

    // 3. 출발 영역 미니맵 표시
    const sp = this.getSpawnArea();
    ctx.fillStyle = 'rgba(0, 255, 200, 0.3)';
    ctx.fillRect(sp.x, sp.y, sp.width, sp.height);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sp.x, sp.y, sp.width, sp.height);

    // 4. 결승선(Goal Line) 표시
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, goalY);
    ctx.lineTo(this.MINIMAP_UNITS, goalY);
    ctx.stroke();

    // 5. 모든 엔티티 렌더링
    const entities = this.stage.entities || [];
    entities.forEach((entity, idx) => {
      const isSel = idx === this.selectedIndex;
      ctx.save();
      ctx.translate(entity.position.x, entity.position.y);

      switch (entity.shape.type) {
        case 'box': {
          const w = entity.shape.width * 2;
          const h = entity.shape.height * 2;
          let rad = ((entity.shape.rotation || 0) * Math.PI) / 180;
          if (this.isTesting && this.isPhysicsReady && this.testPhysics && entity.type === 'kinematic') {
            const physEntities = this.testPhysics.getEntities();
            if (physEntities[idx]) {
              rad = physEntities[idx].angle;
            }
          }
          ctx.rotate(rad);
          ctx.fillStyle = isSel ? '#ffffff' : entity.type === 'kinematic' ? '#ffd600' : '#00bcd4';
          ctx.fillRect(-w / 2, -h / 2, w, h);
          break;
        }
        case 'circle': {
          ctx.fillStyle = isSel ? '#ffffff' : '#ffab00';
          ctx.beginPath();
          ctx.arc(0, 0, entity.shape.radius, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'polyline': {
          ctx.rotate(((entity.shape.rotation || 0) * Math.PI) / 180);
          ctx.strokeStyle = isSel ? '#ffffff' : 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 1;
          if (entity.shape.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(entity.shape.points[0][0], entity.shape.points[0][1]);
            for (let i = 1; i < entity.shape.points.length; i++) {
              ctx.lineTo(entity.shape.points[i][0], entity.shape.points[i][1]);
            }
            ctx.stroke();
          }
          break;
        }
      }
      ctx.restore();
    });

    // 6. 테스트 구슬 표시
    if (this.isTesting && this.testPhysics) {
      this.testMarbles.forEach((m) => {
        const pos = this.testPhysics!.getMarblePosition(m.id);
        if (!pos) return;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 0.35, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 7. 현재 뷰포트 사각형 표시
    const minW = this.screenToWorld(0, 0);
    const maxW = this.screenToWorld(this.canvas.width, this.canvas.height);
    const vpX = minW.x;
    const vpY = minW.y;
    const vpW = maxW.x - minW.x;
    const vpH = maxW.y - minW.y;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(vpX, vpY, vpW, vpH);
    ctx.strokeRect(vpX, vpY, vpW, vpH);

    ctx.restore();
    ctx.restore();
  }
}
