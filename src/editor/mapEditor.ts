import type { StageDef } from '../data/maps';
import { Box2dPhysics } from '../physics-box2d';
import type { EntityShape, MapEntity } from '../types/MapEntity.type';
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

export class MapEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  public stage: StageDef;
  public selectedIndex: number | null = null;
  public onSelectionChange?: (entity: MapEntity | null, index: number | null) => void;
  public onStageChange?: (stage: StageDef) => void;

  // 뷰포트 상태 (월드 좌표)
  public viewX = 13;
  public viewY = 30;
  public zoom = 24; // 1 월드 미터당 24 픽셀

  // 마우스 상태
  private isPanning = false;
  private isDraggingEntity = false;
  private isDraggingGoal = false;
  private panStart = { x: 0, y: 0 };
  private entityDragOffset = { x: 0, y: 0 };

  // 테스트 플레이 상태
  public isTesting = false;
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
    this.stage = JSON.parse(JSON.stringify(newStage));
    this.selectedIndex = null;
    this.viewY = Math.min(this.stage.goalY / 2, 40);
    this.onSelectionChange?.(null, null);
    this.onStageChange?.(this.stage);
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

  private bindEvents() {
    // 캔버스 크기 동기화
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

        // 마우스 커서 위치를 중심으로 확대/축소
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

      // 우클릭, 휠클릭 또는 Space키 조합: 뷰 이동(Pan)
      if (e.button === 1 || e.button === 2 || e.shiftKey || e.altKey) {
        e.preventDefault();
        this.isPanning = true;
        this.panStart = { x: sx, y: sy };
        this.canvas.style.cursor = 'grab';
        return;
      }

      if (e.button === 0) {
        // 골 라인 조작 체크
        if (Math.abs(world.y - this.stage.goalY) < 1.0) {
          this.isDraggingGoal = true;
          this.canvas.style.cursor = 'ns-resize';
          return;
        }

        // 엔티티 클릭 선택 체크 (역순: 위에 그려진 것 먼저)
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
          const ent = entities[hitIndex];
          this.isDraggingEntity = true;
          this.entityDragOffset = {
            x: ent.position.x - world.x,
            y: ent.position.y - world.y,
          };
          this.onSelectionChange?.(ent, hitIndex);
        } else {
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

      if (this.isPanning) {
        const dx = (sx - this.panStart.x) / this.zoom;
        const dy = (sy - this.panStart.y) / this.zoom;
        this.viewX -= dx;
        this.viewY -= dy;
        this.panStart = { x: sx, y: sy };
        return;
      }

      if (this.isDraggingGoal) {
        const newGoalY = Math.max(20, Math.round(world.y * 2) / 2);
        this.stage.goalY = newGoalY;
        this.stage.zoomY = Math.max(15, newGoalY - 5);
        this.onStageChange?.(this.stage);
        return;
      }

      if (this.isDraggingEntity && this.selectedIndex !== null && this.stage.entities) {
        const ent = this.stage.entities[this.selectedIndex];
        if (ent) {
          // 0.25 단위 격자 스냅
          let nx = world.x + this.entityDragOffset.x;
          let ny = world.y + this.entityDragOffset.y;
          nx = Math.round(nx * 4) / 4;
          ny = Math.round(ny * 4) / 4;

          ent.position.x = nx;
          ent.position.y = ny;
          this.onSelectionChange?.(ent, this.selectedIndex);
          this.onStageChange?.(this.stage);
        }
      }
    });

    // 마우스 업
    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.isDraggingEntity = false;
      this.isDraggingGoal = false;
      this.canvas.style.cursor = '';
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

        // 0.5 단위 좌표 스냅
        const snapX = Math.round(world.x * 2) / 2;
        const snapY = Math.round(world.y * 2) / 2;

        const newEntity: MapEntity = {
          position: { x: snapX, y: snapY },
          type: template.entityType,
          shape: JSON.parse(JSON.stringify(template.defaultShape)),
          props: JSON.parse(JSON.stringify(template.defaultProps)),
        };

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

    // 키보드 단축키 (Delete, 복제 Ctrl+D 등)
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.isTesting) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIndex !== null) {
        e.preventDefault();
        this.deleteSelectedEntity();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd' && this.selectedIndex !== null) {
        e.preventDefault();
        this.duplicateSelectedEntity();
      }
    });
  }

  public deleteSelectedEntity() {
    if (this.selectedIndex === null || !this.stage.entities) return;
    this.stage.entities.splice(this.selectedIndex, 1);
    this.selectedIndex = null;
    this.onSelectionChange?.(null, null);
    this.onStageChange?.(this.stage);
  }

  public duplicateSelectedEntity() {
    if (this.selectedIndex === null || !this.stage.entities) return;
    const original = this.stage.entities[this.selectedIndex];
    const clone: MapEntity = JSON.parse(JSON.stringify(original));
    clone.position.x += 1;
    clone.position.y += 1;
    this.stage.entities.push(clone);
    this.selectedIndex = this.stage.entities.length - 1;
    this.onSelectionChange?.(clone, this.selectedIndex);
    this.onStageChange?.(this.stage);
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
    } else if (shape.type === 'circle') {
      const distSq = dx * dx + dy * dy;
      const r = Math.max(shape.radius, 0.4);
      return distSq <= r * r;
    } else if (shape.type === 'polyline') {
      // polyline 점들과의 근접 테스트
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
    this.isTesting = true;
    this.selectedIndex = null;
    this.onSelectionChange?.(null, null);

    this.testPhysics = new Box2dPhysics();
    await this.testPhysics.init();
    this.testPhysics.createStage(this.stage);

    // 테스트용 구슬 12개 생성 (스폰 영역: x 10~15, y 1~4)
    this.testMarbles = [];
    for (let i = 0; i < 12; i++) {
      const x = 11 + (i % 4) * 0.8;
      const y = 2 + Math.floor(i / 4) * 0.8;
      const color = `hsl(${(i * 30) % 360}, 100%, 70%)`;
      this.testPhysics.createMarble(i, x, y);
      this.testMarbles.push({ id: i, color });
    }

    this.testPhysics.start();
    this.testLastTime = performance.now();
  }

  public stopTestPlay() {
    this.isTesting = false;
    if (this.testPhysics) {
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

      if (this.isTesting && this.testPhysics) {
        const dt = Math.min(time - this.testLastTime, 50);
        this.testLastTime = time;
        const subSteps = 2;
        const subStepSec = dt / 1000 / subSteps;
        for (let i = 0; i < subSteps; i++) {
          this.testPhysics.step(subStepSec);
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

    // 배경 클리어 (다크 테마)
    ctx.fillStyle = '#181a1b';
    ctx.fillRect(0, 0, w, h);

    // 1. 그리드(Grid) 그리기
    this.drawGrid();

    // 2. 출발 영역 (Spawn Zone)
    this.drawSpawnArea();

    // 3. 골 라인 (Goal Line)
    this.drawGoalLine();

    // 4. 엔티티들 렌더링
    this.drawEntities();

    // 5. 테스트 플레이 구슬 렌더링
    if (this.isTesting && this.testPhysics) {
      this.drawTestMarbles();
    }
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
    const p1 = this.worldToScreen(9.25, 0);
    const p2 = this.worldToScreen(16.5, 6);

    ctx.save();
    ctx.fillStyle = 'rgba(0, 255, 200, 0.04)';
    ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

    ctx.strokeStyle = 'rgba(0, 255, 200, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

    ctx.fillStyle = 'rgba(0, 255, 200, 0.8)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('▼ 구슬 출발 영역 (Spawn Zone)', p1.x + 8, p1.y + 8);
    ctx.restore();
  }

  private drawGoalLine() {
    const ctx = this.ctx;
    const goalY = this.stage.goalY;
    const sy = this.worldToScreen(0, goalY).y;

    ctx.save();
    // 체크무늬 골 라인
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

    // 라벨
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

      // 선택된 객체 하이라이트 효과
      if (isSelected) {
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 12;
      }

      switch (shape.type) {
        case 'box': {
          const w = shape.width * 2 * this.zoom;
          const h = shape.height * 2 * this.zoom;
          const rad = (shape.rotation * Math.PI) / 180;
          ctx.rotate(rad);

          // 회전 막대 (kinematic) vs 고정 네모 (static) 색상 구분
          const isKinematic = entity.type === 'kinematic';
          ctx.fillStyle = isKinematic ? '#226f92' : '#1b5e7d';
          ctx.strokeStyle = isSelected ? '#ffffff' : isKinematic ? '#4dd0e1' : '#00bcd4';
          ctx.lineWidth = isSelected ? 2.5 : 1.5;

          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeRect(-w / 2, -h / 2, w, h);

          // 회전 막대 회전 방향 인디케이터
          if (isKinematic) {
            ctx.fillStyle = '#ffeb3b';
            ctx.beginPath();
            ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.fill();

            // 회전 속도 표시
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

          // 버블 내구도(life) 표시
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

            // 점마다 작은 마커 표시
            for (const pt of shape.points) {
              ctx.fillStyle = isSelected ? '#00ffff' : 'rgba(255, 255, 255, 0.6)';
              ctx.beginPath();
              ctx.arc(pt[0] * this.zoom, pt[1] * this.zoom, isSelected ? 4 : 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          break;
        }
      }

      ctx.restore();
    });
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
}
