import { AvatarManager } from './avatarManager';
import { BgmManager } from './bgmManager';
import { Camera } from './camera';
import { canvasHeight, canvasWidth, initialZoom, Skills, Themes, zoomThreshold } from './data/constants';
import { type StageDef, stages } from './data/maps';
import { FastForwader } from './fastForwader';
import type { GameObject } from './gameObject';
import type { IPhysics } from './IPhysics';
import { Marble } from './marble';
import { Minimap } from './minimap';
import options, { type WinnerRange } from './options';
import { ParticleManager } from './particleManager';
import { Box2dPhysics } from './physics-box2d';
import { RankRenderer } from './rankRenderer';
import { RouletteRenderer } from './rouletteRenderer';
import { SkillEffect } from './skillEffect';
import { SoundManager } from './soundManager';
import type { ColorTheme } from './types/ColorTheme';
import type { MouseEventHandlerName, MouseEventName } from './types/mouseEvents.type';
import type { UIObject } from './UIObject';
import { bound } from './utils/bound.decorator';
import { parseName, shuffle } from './utils/utils';
import { VideoRecorder } from './utils/videoRecorder';

/** 입력 범위를 실제 구슬 수에 맞춰 자른다. 범위를 넘기면 뒤쪽이 잘린다 */
function clipWinnerRange({ start, end }: WinnerRange, marbleCount: number): WinnerRange {
  const last = Math.max(0, marbleCount - 1);
  const clippedStart = Math.min(Math.max(0, start), last);
  return { start: clippedStart, end: Math.min(Math.max(clippedStart, end), last) };
}

export class Roulette extends EventTarget {
  private _marbles: Marble[] = [];
  private _selectedMarble: Marble | null = null;

  private _lastTime: number = 0;
  private _timeScale = 1;
  private _speed = 1;

  private _winners: Marble[] = [];
  private _particleManager = new ParticleManager();
  private _stage: StageDef | null = null;

  protected _camera: Camera = new Camera();
  protected _renderer: RouletteRenderer;

  private _effects: GameObject[] = [];

  private _winnerRange: WinnerRange = { start: 0, end: 0 };
  private _goalDist: number = Infinity;
  private _isRunning: boolean = false;
  private _isPaused: boolean = false;
  private _isFullMapView: boolean = false;
  private _keysDown: Set<string> = new Set();
  private _keyHoldDuration: number = 0;
  private _isMiddleDragging: boolean = false;
  private _lastMiddlePos: { x: number; y: number } = { x: 0, y: 0 };
  private _manualResumeTimeout: number | null = null;
  /** 진행 중에는 null, 당첨자가 모두 확정되면 당첨자 배열 */
  private _result: Marble[] | null = null;

  // 구슬 id(= order)는 매 라운드 재사용된다. 리셋 시 취소하지 않으면 이 타이머가
  // 뒤늦게 발화해 같은 id를 가진 새 라운드의 구슬을 지워버린다
  private _pendingRemovals: number[] = [];

  private _uiObjects: UIObject[] = [];

  private _autoRecording: boolean = false;
  private _recorder!: VideoRecorder;

  private physics!: IPhysics;

  private _isReady: boolean = false;
  protected fastForwarder!: FastForwader;
  protected _theme: ColorTheme = Themes.dark;

  private _bgmManager: BgmManager = new BgmManager();
  private _soundManager: SoundManager = new SoundManager();
  /** 구슬 골인 효과음 쿨다운 (너무 자주 재생 방지) ms */
  private _goalSoundLastTime: number = 0;
  private _lastGoalTime: number = 0;

  get isReady() {
    return this._isReady;
  }

  protected createRenderer(): RouletteRenderer {
    return new RouletteRenderer();
  }

  protected createFastForwader(): FastForwader {
    return new FastForwader();
  }

  constructor() {
    super();
    this._renderer = this.createRenderer();
    this._renderer.init().then(() => {
      this._init().then(() => {
        this._isReady = true;
        this._update();
      });
    });
  }

  public getZoom() {
    return initialZoom * this._camera.zoom;
  }

  private addUiObject(obj: UIObject) {
    this._uiObjects.push(obj);
    if (obj.onWheel) {
      this._renderer.canvas.addEventListener('wheel', obj.onWheel);
    }
    if (obj.onMessage) {
      obj.onMessage((msg) => {
        console.log('onMessage', msg);
        this.dispatchEvent(new CustomEvent('message', { detail: msg }));
      });
    }
  }

  @bound
  private _update() {
    if (!this._lastTime) this._lastTime = performance.now();
    const currentTime = performance.now();
    const dt = Math.min(currentTime - this._lastTime, 100);
    this._lastTime = currentTime;

    if (!this._isPaused) {
      // 프레임 경과 시간에 배속 적용
      const frameElapsed = dt * this._speed * this.fastForwarder.speed;
      const timeScale = this._timeScale;

      // 모니터 주사율(60Hz, 120Hz, 144Hz 등)에 맞춘 서브스텝 분할:
      // 고정 10ms 루프의 1스텝/2스텝 교번(aliasing)으로 인한 30Hz 미세 진동을 원천 제거하고,
      // 매 디스플레이 프레임마다 모니터 주사율에 맞춰 정확하게 균일한 물리 이동량을 반영
      const targetSubStepMs = 8.33; // 120Hz 수준의 안정적인 Box2D 물리 해상도 유지
      const subSteps = Math.max(1, Math.round(frameElapsed / targetSubStepMs));
      const subStepMs = frameElapsed / subSteps;
      const subStepSec = (subStepMs / 1000) * timeScale;

      for (let i = 0; i < subSteps; i++) {
        this.physics.step(subStepSec);
        this._updateMarbles(subStepMs, timeScale);
        this._particleManager.update(subStepMs);
        this._updateEffects(subStepMs);
        this._uiObjects.forEach((obj) => obj.update(subStepMs));
      }

      if (this._marbles.length > 1) {
        this._marbles.sort((a, b) => b.y - a.y);
      }
    }

    // 방향키 카메라 수동 이동 처리 (일시정지 중에도 조작 가능)
    this._handleKeyboardNavigation(dt);

    if (this._stage) {
      this._camera.update({
        marbles: this._marbles,
        stage: this._stage,
        needToZoom: this._goalDist < zoomThreshold,
        targetIndex: this._winners.length > 0 ? this._targetIndex : 0,
        deltaTime: dt / 1000,
      });
    }

    this._render();
    window.requestAnimationFrame(this._update);
  }

  private _handleKeyboardNavigation(dt: number) {
    if (this._keysDown.size === 0) {
      this._keyHoldDuration = 0;
      return;
    }

    this._keyHoldDuration += dt;
    // 적응형 가속: 누르고 있을수록 가속 (1.0 -> 최대 3.5)
    const accelFactor = Math.min(3.5, 1 + this._keyHoldDuration / 500);
    // 현재 줌에 반비례하여 화면상 체감 이동 속도를 균일하게 유지
    const baseSpeed = (18 / Math.max(0.4, this._camera.zoom)) * (dt / 1000);
    const moveDist = baseSpeed * accelFactor;

    let dx = 0;
    let dy = 0;
    if (this._keysDown.has('ArrowLeft')) dx -= moveDist;
    if (this._keysDown.has('ArrowRight')) dx += moveDist;
    if (this._keysDown.has('ArrowUp')) dy -= moveDist;
    if (this._keysDown.has('ArrowDown')) dy += moveDist;

    if (dx !== 0 || dy !== 0) {
      this._camera.pan(dx, dy);
    }
  }

  private _updateMarbles(deltaTime: number, timeScale: number) {
    if (!this._stage) return;

    for (let i = 0; i < this._marbles.length; i++) {
      const marble = this._marbles[i];
      marble.update(deltaTime, timeScale);
      if (marble.skill === Skills.Impact) {
        this._effects.push(new SkillEffect(marble.x, marble.y));
        this.physics.impact(marble.id);
      }
      if (marble.y > this._stage.goalY) {
        this._winners.push(marble);
        this._lastGoalTime = performance.now();
        if (this._isRunning && this._isWinningRank(this._winners.length - 1)) {
          this._particleManager.shot(this._renderer.width, this._renderer.height);
        }
        // 골인 효과음 (쿨다운 200ms)
        const now = performance.now();
        if (now - this._goalSoundLastTime > 200) {
          this._soundManager.playGoalIn();
          this._goalSoundLastTime = now;
        }
        this._pendingRemovals.push(
          window.setTimeout(() => {
            this.physics.removeMarble(marble.id);
          }, 500)
        );
      }
    }

    const targetIndex = this._targetIndex;
    const topY = this._marbles[targetIndex] ? this._marbles[targetIndex].y : 0;
    this._goalDist = Math.abs(this._stage.zoomY - topY);
    this._timeScale = this._calcTimeScale();

    this._marbles = this._marbles.filter((marble) => marble.y <= this._stage?.goalY);

    this._checkFinish();
  }

  /** 카메라와 슬로우모션이 주목할 구슬 = 당첨 커트라인에 걸쳐있는 구슬 */
  private get _targetIndex() {
    return this._winnerRange.end - this._winners.length;
  }

  private _isWinningRank(rank: number) {
    return rank >= this._winnerRange.start && rank <= this._winnerRange.end;
  }

  private _checkFinish() {
    if (!this._isRunning) return;
    const { start, end } = this._winnerRange;

    // 마지막 구슬까지 모두 골인한 후에 결과 확정 및 결과창 팝업
    // 아직 트랙을 주행 중인 구슬이 남아있다면 경기를 계속 진행
    if (this._marbles.length > 0) {
      // 안전 워치독: 당첨자가 이미 모두 결정되었고 남은 구슬이 15초 이상 멈춰서 정체된 경우에만 안전 종료
      const allWinnersDecided = this._winners.length > end;
      if (allWinnersDecided && this._lastGoalTime > 0) {
        const now = performance.now();
        if (now - this._lastGoalTime > 15000) {
          // 정체된 남은 구슬들을 현재 Y 위치 순으로 우승자 목록에 추가하고 종료
          const remaining = [...this._marbles].sort((a, b) => b.y - a.y);
          this._winners.push(...remaining);
          this._marbles = [];
        } else {
          return;
        }
      } else {
        return;
      }
    }

    if (this._winners.length <= end) return;

    this._result = this._winners.slice(start, end + 1);
    this._isRunning = false;
    this._isPaused = false;

    // 우승 팡파르 효과음 재생 & BGM 정지
    this._soundManager.playFanfare();
    setTimeout(() => {
      this._bgmManager.stop();
    }, 1500);

    this.dispatchEvent(
      new CustomEvent('goal', {
        detail: { winner: this._result[0].name, winners: this._result.map((m) => m.name) },
      })
    );
    setTimeout(() => {
      this._recorder.stop();
    }, 1000);
  }

  private _calcTimeScale(): number {
    if (!this._stage) return 1;
    const targetIndex = this._targetIndex;
    if (this._winners.length < this._winnerRange.end + 1 && this._goalDist < zoomThreshold) {
      if (
        this._marbles[targetIndex].y > this._stage.zoomY - zoomThreshold * 1.2 &&
        (this._marbles[targetIndex - 1] || this._marbles[targetIndex + 1])
      ) {
        return Math.max(0.2, this._goalDist / zoomThreshold);
      }
    }
    return 1;
  }

  private _updateEffects(deltaTime: number) {
    this._effects.forEach((effect) => effect.update(deltaTime));
    this._effects = this._effects.filter((effect) => !effect.isDestroy);
  }

  private _render() {
    if (!this._stage) return;
    const renderParams = {
      camera: this._camera,
      stage: this._stage,
      entities: this.physics.getEntities(),
      marbles: this._marbles,
      winners: this._winners,
      particleManager: this._particleManager,
      effects: this._effects,
      winnerRange: this._winnerRange,
      result: this._result,
      size: { x: this._renderer.width, y: this._renderer.height },
      theme: this._theme,
      isPaused: this._isPaused,
    };
    this._renderer.render(renderParams, this._uiObjects);
  }

  private async _init() {
    this._recorder = new VideoRecorder(this._renderer.canvas);

    this.physics = new Box2dPhysics();
    await this.physics.init();

    this.addUiObject(new RankRenderer());
    this.attachEvent();
    const minimap = new Minimap();
    minimap.onViewportChange((pos) => {
      if (pos) {
        this._camera.setPosition(pos, false);
        this._camera.lock(true);
      } else {
        this._camera.lock(false);
      }
    });
    this.addUiObject(minimap);
    this.fastForwarder = this.createFastForwader();
    this.addUiObject(this.fastForwarder);
    this._stage = stages[0];
    this._loadMap();
  }

  @bound
  private mouseHandler(eventName: MouseEventName, e: MouseEvent) {
    const handlerName = `on${eventName}` as MouseEventHandlerName;

    const sizeFactor = this._renderer.sizeFactor;
    const pos = { x: e.offsetX * sizeFactor, y: e.offsetY * sizeFactor };
    this._uiObjects.forEach((obj) => {
      if (!obj[handlerName]) return;
      const bounds = obj.getBoundingBox();
      if (!bounds) {
        obj[handlerName]({ ...pos, button: e.button });
      } else if (
        bounds &&
        pos.x >= bounds.x &&
        pos.y >= bounds.y &&
        pos.x <= bounds.x + bounds.w &&
        pos.y <= bounds.y + bounds.h
      ) {
        obj[handlerName]({ x: pos.x - bounds.x, y: pos.y - bounds.y, button: e.button });
      } else {
        obj[handlerName](undefined);
      }
    });
  }

  private attachEvent() {
    const canvas = this._renderer.canvas;
    const onPointerRelease = (e: Event) => {
      this.mouseHandler('MouseUp', e as MouseEvent);
      window.removeEventListener('pointerup', onPointerRelease);
      window.removeEventListener('pointercancel', onPointerRelease);
    };

    // 휠 클릭(마우스 중간 버튼) 드래그로 실제 맵 이동
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        this._isMiddleDragging = true;
        this._lastMiddlePos = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (this._isMiddleDragging) {
        const dx = e.clientX - this._lastMiddlePos.x;
        const dy = e.clientY - this._lastMiddlePos.y;
        this._lastMiddlePos = { x: e.clientX, y: e.clientY };

        const sizeFactor = this._renderer.sizeFactor;
        const totalZoom = initialZoom * this._camera.zoom;
        const worldDx = -(dx * sizeFactor) / totalZoom;
        const worldDy = -(dy * sizeFactor) / totalZoom;

        this._camera.pan(worldDx, worldDy, true);
      }
    });

    const stopMiddleDrag = (e?: PointerEvent | MouseEvent) => {
      if (this._isMiddleDragging) {
        if (!e || (e as MouseEvent).button === 1 || e.type === 'blur') {
          this._isMiddleDragging = false;
          canvas.style.cursor = '';
          if (this._isRunning) {
            if (this._manualResumeTimeout) clearTimeout(this._manualResumeTimeout);
            this._manualResumeTimeout = window.setTimeout(() => {
              if (this._isRunning && !this._isMiddleDragging && this._keysDown.size === 0) {
                this._camera.resetManual();
                this.dispatchEvent(new CustomEvent('message', { detail: '카메라: 선두 추적 복귀' }));
              }
            }, 2500);
          }
        }
      }
    };

    window.addEventListener('pointerup', stopMiddleDrag);
    window.addEventListener('pointercancel', stopMiddleDrag);
    window.addEventListener('blur', () => stopMiddleDrag());

    // 브라우저 기본 휠 클릭(스크롤 앵커 등) 방지
    canvas.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    });

    canvas.addEventListener('pointerdown', (e: Event) => {
      this.mouseHandler('MouseDown', e as MouseEvent);
      window.addEventListener('pointerup', onPointerRelease);
      window.addEventListener('pointercancel', onPointerRelease);
    });

    ['MouseMove', 'DblClick'].forEach((ev) => {
      // @ts-expect-error
      canvas.addEventListener(ev.toLowerCase().replace('mouse', 'pointer'), this.mouseHandler.bind(this, ev));
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    canvas.addEventListener('click', (e) => {
      if (this.resultCloseHitAt(e)) {
        this._renderer.closeResultPopup();
        return;
      }
      // 마우스 좌클릭 시: 주행 중이면 일시정지 / 재개, 대기 중이면 마블 선택
      if (e.button === 0) {
        if (this._isRunning) {
          this.togglePause();
        } else {
          this._handleMarbleClick(e);
        }
      }
    });

    window.addEventListener('paste', async (e: ClipboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if (!this._selectedMarble) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            try {
              const dataUrl = await AvatarManager.processImageBlob(blob);
              AvatarManager.setAvatar(this._selectedMarble.name, dataUrl);
              this.dispatchEvent(
                new CustomEvent('message', {
                  detail: `📷 [${this._selectedMarble.name}] 마블에 얼굴 사진이 등록되었습니다!`,
                })
              );
            } catch (err) {
              console.error('Failed to process image:', err);
              this.dispatchEvent(new CustomEvent('message', { detail: '⚠️ 이미지 처리 중 오류가 발생했습니다.' }));
            }
            break;
          }
        }
      }
    });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedMarble) {
        if (AvatarManager.hasAvatar(this._selectedMarble.name)) {
          e.preventDefault();
          AvatarManager.removeAvatar(this._selectedMarble.name);
          this.dispatchEvent(
            new CustomEvent('message', {
              detail: `🗑️ [${this._selectedMarble.name}] 마블의 얼굴 사진이 삭제되었습니다.`,
            })
          );
          return;
        }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        this._keysDown.add(e.key);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._isFullMapView = false;
        this._camera.resetManual();
        this.dispatchEvent(new CustomEvent('message', { detail: '카메라: 선두 추적 복귀' }));
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (this._isRunning) {
          this.togglePause();
        }
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this._toggleFullMapView();
      } else if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const rankIdx = parseInt(e.key, 10) - 1;
        this._focusMarbleByRank(rankIdx);
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        this._keysDown.delete(e.key);
        if (this._keysDown.size === 0) {
          this._keyHoldDuration = 0;
          if (this._isRunning) {
            if (this._manualResumeTimeout) clearTimeout(this._manualResumeTimeout);
            this._manualResumeTimeout = window.setTimeout(() => {
              if (this._isRunning && !this._isMiddleDragging && this._keysDown.size === 0) {
                this._camera.resetManual();
                this.dispatchEvent(new CustomEvent('message', { detail: '카메라: 선두 추적 복귀' }));
              }
            }, 2500);
          }
        }
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this._isMiddleDragging) {
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (this.resultCloseHitAt(e)) {
        canvas.style.cursor = 'pointer';
        return;
      }
      if (!this._isRunning) {
        const sizeFactor = this._renderer.sizeFactor;
        const sceneX = e.offsetX * sizeFactor;
        const sceneY = e.offsetY * sizeFactor;
        const totalZoom = initialZoom * this._camera.zoom;
        const worldX = this._camera.x + (sceneX - this._renderer.width / 2) / totalZoom;
        const worldY = this._camera.y + (sceneY - this._renderer.height / 2) / totalZoom;
        const hoveredMarble = this._marbles.find((m) => {
          const dist = Math.hypot(m.x - worldX, m.y - worldY);
          return dist <= Math.max(m.size * 0.85, 0.5);
        });
        if (hoveredMarble) {
          canvas.style.cursor = 'pointer';
          canvas.title = `📷 [${hoveredMarble.name}] 클릭하여 선택 (Ctrl+V로 얼굴 사진 등록)`;
          return;
        }
      }
      canvas.style.cursor = '';
      canvas.title = '';
    });

    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        // 우측 순위표 컬럼(160px) 밖에서 휠 스크롤 시 카메라 줌 인/아웃
        if (x < rect.width - 160) {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          this._camera.zoomBy(factor);
        }
      },
      { passive: false }
    );
  }

  private _loadMap() {
    if (!this._stage) {
      throw new Error('No map has been selected');
    }

    this.physics.createStage(this._stage);
    this._camera.initializePosition();
  }

  public selectMarble(marble: Marble): void {
    if (this._selectedMarble && this._selectedMarble !== marble) {
      this._selectedMarble.isSelected = false;
    }
    this._selectedMarble = marble;
    marble.isSelected = true;
    const hasAvatar = AvatarManager.hasAvatar(marble.name);
    const hint = hasAvatar
      ? `📷 [${marble.name}] 선택됨 (현재 사진 적용 중, Delete키로 삭제 가능)`
      : `📷 [${marble.name}] 선택됨! 사진 복사 후 Ctrl+V 로 얼굴 등록`;
    this.dispatchEvent(new CustomEvent('message', { detail: hint }));
  }

  public clearSelectedMarble(): void {
    if (this._selectedMarble) {
      this._selectedMarble.isSelected = false;
      this._selectedMarble = null;
    }
  }

  public getBgmManager(): BgmManager {
    return this._bgmManager;
  }

  public getMarbles(): Marble[] {
    return this._marbles;
  }

  public getSelectedMarble(): Marble | null {
    return this._selectedMarble;
  }

  public async setMarbleAvatar(name: string, dataUrl: string): Promise<void> {
    AvatarManager.setAvatar(name, dataUrl);
    this.dispatchEvent(new CustomEvent('message', { detail: `📷 [${name}] 마블에 얼굴 사진이 등록되었습니다!` }));
  }

  public removeMarbleAvatar(name: string): void {
    AvatarManager.removeAvatar(name);
    this.dispatchEvent(new CustomEvent('message', { detail: `🗑️ [${name}] 마블의 얼굴 사진이 삭제되었습니다.` }));
  }

  public clearAllMarbleAvatars(): void {
    AvatarManager.clearAll();
    this.dispatchEvent(new CustomEvent('message', { detail: '🗑️ 모든 마블의 얼굴 사진이 초기화되었습니다.' }));
  }

  public promptFileUpload(targetName?: string): void {
    const name = targetName || this._selectedMarble?.name;
    if (!name) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        try {
          const dataUrl = await AvatarManager.processImageBlob(file);
          this.setMarbleAvatar(name, dataUrl);
        } catch (e) {
          console.error(e);
          this.dispatchEvent(new CustomEvent('message', { detail: '⚠️ 이미지 처리 중 오류가 발생했습니다.' }));
        }
      }
    };
    input.click();
  }

  private _handleMarbleClick(e: MouseEvent): void {
    (document.activeElement as HTMLElement)?.blur();
    const sizeFactor = this._renderer.sizeFactor;
    const sceneX = e.offsetX * sizeFactor;
    const sceneY = e.offsetY * sizeFactor;
    const totalZoom = initialZoom * this._camera.zoom;
    const worldX = this._camera.x + (sceneX - this._renderer.width / 2) / totalZoom;
    const worldY = this._camera.y + (sceneY - this._renderer.height / 2) / totalZoom;

    let closestMarble: Marble | null = null;
    let minDist = Infinity;

    for (const m of this._marbles) {
      const dist = Math.hypot(m.x - worldX, m.y - worldY);
      const hitRadius = Math.max(m.size * 0.85, 0.5);
      if (dist <= hitRadius && dist < minDist) {
        minDist = dist;
        closestMarble = m;
      }
    }

    if (closestMarble) {
      this.selectMarble(closestMarble);
    } else {
      this.clearSelectedMarble();
    }
  }

  public clearMarbles() {
    this.clearSelectedMarble();
    this._pendingRemovals.forEach((id) => window.clearTimeout(id));
    this._pendingRemovals = [];
    this.physics.clearMarbles();
    this._result = null;
    this._winners = [];
    this._marbles = [];
  }

  public async startRecording() {
    if (!this._autoRecording) return;
    try {
      await this._recorder.start();
    } catch (e) {
      console.error('recording failed to start', e);
    }
  }

  public togglePause(): void {
    if (!this._isRunning) return;
    this._isPaused = !this._isPaused;
  }

  public get isPaused(): boolean {
    return this._isPaused;
  }

  public start() {
    this._isRunning = true;
    this._isPaused = false;
    this._lastGoalTime = performance.now();
    this._winnerRange = clipWinnerRange(options.winnerRange, this._marbles.length);
    this._camera.startFollowingMarbles();

    // BGM 시작 및 효과음 활성화 (첫 사용자 상호작용)
    this._soundManager.unlock();
    this._bgmManager.play();

    if (this._autoRecording) {
      this._recorder.start().then(() => {
        this.physics.start();
        this._marbles.forEach((marble) => (marble.isActive = true));
      });
    } else {
      this.physics.start();
      this._marbles.forEach((marble) => (marble.isActive = true));
    }
  }

  public setSpeed(value: number) {
    if (value <= 0) {
      throw new Error('Speed multiplier must larger than 0');
    }
    this._speed = value;
  }

  private resultCloseHitAt(e: MouseEvent): boolean {
    const sizeFactor = this._renderer.sizeFactor;
    return this._renderer.getResultCloseHitAt(e.offsetX * sizeFactor, e.offsetY * sizeFactor);
  }

  public setTheme(themeName: keyof typeof Themes) {
    this._theme = Themes[themeName];
  }

  public getSpeed() {
    return this._speed;
  }

  public setWinningRank(rank: number) {
    this.setWinnerRange(rank, rank);
  }

  public setWinnerRange(start: number, end: number) {
    options.winnerRange = { start, end };
    this._winnerRange = clipWinnerRange(options.winnerRange, this._marbles.length);
  }

  /** 실제 구슬 수에 맞춰 잘린 범위 (0-based, 양끝 포함) */
  public getWinnerRange(): WinnerRange {
    return { ...this._winnerRange };
  }

  public setAutoRecording(value: boolean) {
    this._autoRecording = value;
  }

  public setMarbles(names: string[]) {
    this.reset();
    const arr = names.slice();

    let maxWeight = -Infinity;
    let minWeight = Infinity;

    const members = arr
      .map((nameString) => {
        const result = parseName(nameString);
        if (!result) return null;
        const { name, weight, count } = result;
        if (weight > maxWeight) maxWeight = weight;
        if (weight < minWeight) minWeight = weight;
        return { name, weight, count };
      })
      .filter((member) => !!member);

    const gap = maxWeight - minWeight;

    let totalCount = 0;
    members.forEach((member) => {
      if (member) {
        member.weight = 0.1 + (gap ? (member.weight - minWeight) / gap : 0);
        totalCount += member.count;
      }
    });

    const sp = this._stage?.spawnArea ?? { x: 9.25, y: 0, width: 7.25, height: 6 };

    // 마블 물리 반경: 0.25 (지름: 0.50)
    // 마블끼리 떨어진 간격 (기존 gap = 0.10에서 2배인 0.20으로 적용 -> spacing = 0.70)
    const marbleSpacingX = 0.7;
    const marbleSpacingY = 0.7;
    const marginX = 0.45; // 좌우 벽과의 여유 공간
    const marginY = 0.4; // 시작 영역 최상단 천장과의 여유 공간

    // 가로 폭에서 한 줄에 최대로 들어갈 수 있는 열(column) 수
    const availableWidth = Math.max(marbleSpacingX, sp.width - marginX * 2);
    const maxCols = Math.max(1, Math.floor(availableWidth / marbleSpacingX) + 1);

    // 구슬 개수가 maxCols 이하이면 1줄로 배치하여 모든 구슬이 동일한 최상단 Y 높이에서 공평하게 출발
    const rows = Math.max(1, Math.ceil(totalCount / maxCols));
    const cols = Math.max(1, Math.ceil(totalCount / rows));

    // 세로 공간이 부족한 극단적인 경우(수백 개 등)에만 겹치지 않는 한도에서 Y 간격 축소
    const actualSpacingY = Math.min(
      marbleSpacingY,
      rows > 1 ? Math.max(0.52, (sp.height - marginY * 2) / (rows - 1)) : marbleSpacingY
    );

    const marblePositions: { x: number; y: number }[] = [];
    for (let i = 0; i < totalCount; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const countInThisRow = Math.min(cols, totalCount - row * cols);
      const rowWidth = (countInThisRow - 1) * marbleSpacingX;
      const rowStartX = sp.x + (sp.width - rowWidth) / 2;
      const x = countInThisRow > 1 ? rowStartX + col * marbleSpacingX : sp.x + sp.width / 2;
      const y = sp.y + marginY + row * actualSpacingY;
      marblePositions.push({ x, y });
    }

    const orders = shuffle(
      Array(totalCount)
        .fill(0)
        .map((_, i) => i)
    );
    members.forEach((member) => {
      if (member) {
        for (let j = 0; j < member.count; j++) {
          const order = orders.pop() || 0;
          const pos = marblePositions[order] || { x: sp.x + sp.width / 2, y: sp.y + marginY };
          this._marbles.push(new Marble(this.physics, order, totalCount, member.name, member.weight, pos));
        }
      }
    });

    // 카메라를 구슬 생성 위치(출발 영역 상단)로 이동 + 줌인
    if (totalCount > 0) {
      const centerX = sp.x + sp.width / 2;
      const topY = sp.y + marginY;
      const bottomY = sp.y + marginY + (rows - 1) * actualSpacingY;
      const groupCenterY = (topY + bottomY) / 2;
      const groupHeight = Math.max(sp.height, bottomY - topY + 2);

      const margin = 2.5;
      const viewW = canvasWidth / initialZoom;
      const viewH = canvasHeight / initialZoom;
      const zoom = Math.max(
        1.2,
        Math.min(Math.min(viewW / (sp.width + margin * 2), viewH / (groupHeight + margin * 2)), 2.8)
      );

      this._camera.initializePosition({ x: centerX, y: groupCenterY + 1.0 }, zoom);
    }
  }

  private _toggleFullMapView() {
    if (!this._stage) return;
    if (this._isFullMapView) {
      this._isFullMapView = false;
      this._camera.resetManual();
      this.dispatchEvent(new CustomEvent('message', { detail: '카메라: 선두 추적 모드' }));
    } else {
      this._isFullMapView = true;
      const goalY = this._stage.goalY;
      const viewW = canvasWidth / initialZoom;
      const viewH = canvasHeight / initialZoom;
      const targetZoom = Math.max(0.2, Math.min(viewW / 28, viewH / (goalY + 10)));
      this._camera.setPosition({ x: 13, y: goalY / 2 }, false);
      this._camera.zoom = targetZoom;
      this._camera.lock(true);
      this.dispatchEvent(new CustomEvent('message', { detail: '🔭 맵 전체 조망 (F / Enter로 복귀)' }));
    }
  }

  private _focusMarbleByRank(rankIdx: number) {
    if (!this._marbles || this._marbles.length <= rankIdx) return;
    const marble = this._marbles[rankIdx];
    this._isFullMapView = false;
    this._camera.setPosition({ x: marble.x, y: marble.y }, false);
    this._camera.zoom = 1.6;
    this._camera.lock(true);
    this.dispatchEvent(
      new CustomEvent('message', {
        detail: `🔍 #${rankIdx + 1} ${marble.name} 관전 (Enter로 복귀)`,
      })
    );
  }

  private _clearMap() {
    this.physics.clear();
    this._marbles = [];
  }

  public reset() {
    this._isPaused = false;
    this._keysDown.clear();
    this._keyHoldDuration = 0;
    this.clearMarbles();
    this._clearMap();
    this._loadMap();
    this._goalDist = Infinity;
  }

  public getCount() {
    return this._marbles.length;
  }

  private _customStages: StageDef[] = [];

  public addCustomMap(stage: StageDef): number {
    const existingIdx = this._customStages.findIndex((s) => s.title === stage.title);
    let targetIdx: number;
    if (existingIdx >= 0) {
      this._customStages[existingIdx] = stage;
      targetIdx = stages.length + existingIdx;
    } else {
      this._customStages.push(stage);
      targetIdx = stages.length + this._customStages.length - 1;
    }
    this.setMap(targetIdx);
    return targetIdx;
  }

  public removeCustomMap(index: number): boolean {
    const customIdx = index - stages.length;
    if (customIdx < 0 || customIdx >= this._customStages.length) {
      return false;
    }
    this._customStages.splice(customIdx, 1);
    this.setMap(0);
    return true;
  }

  public getAllStages(): StageDef[] {
    return [...stages, ...this._customStages];
  }

  public getCurrentStage(): StageDef | null {
    return this._stage;
  }

  public getMaps() {
    return this.getAllStages().map((stage, index) => {
      return {
        index,
        title: index >= stages.length ? `[커스텀] ${stage.title}` : stage.title,
      };
    });
  }

  public getCurrentMap() {
    if (!this._stage) return null;
    const all = this.getAllStages();
    return {
      index: all.indexOf(this._stage),
      title: this._stage.title,
    };
  }

  public setMap(index: number) {
    const all = this.getAllStages();
    if (index < 0 || index > all.length - 1) {
      throw new Error('Incorrect map number');
    }
    const names = this._marbles.map((marble) => marble.name);
    this._stage = all[index];
    this.setMarbles(names);
  }
}
