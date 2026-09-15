import { type StageDef, stages } from '../data/maps';
import type { EntityBoxShape, EntityCircleShape, MapEntity } from '../types/MapEntity.type';
import { type DragTemplateData, MapEditor } from './mapEditor';
import { exportMapToJsonFile, exportMapToUrl, importMapFromJsonFile, saveCustomMapToLocal } from './mapSerializer';

export class MapEditorUI {
  private container: HTMLElement;
  private editor: MapEditor;
  private onExitCallback: (stage: StageDef) => void;

  private titleInput!: HTMLInputElement;
  private goalYInput!: HTMLInputElement;
  private goalYSlider!: HTMLInputElement;
  private spawnXInput!: HTMLInputElement;
  private spawnYInput!: HTMLInputElement;
  private spawnWInput!: HTMLInputElement;
  private spawnHInput!: HTMLInputElement;
  private inspectorPanel!: HTMLElement;
  private testPlayBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, initialStage?: StageDef, onExit?: (stage: StageDef) => void) {
    this.container = container;
    this.onExitCallback = onExit || (() => {});

    this.renderLayout();

    const canvas = container.querySelector('#editorCanvas') as HTMLCanvasElement;
    this.editor = new MapEditor(canvas, initialStage);

    this.bindEditorEvents();
    this.syncInitialStage();
    this.updateInspector(null, null);
  }

  private syncInitialStage() {
    this.titleInput.value = this.editor.stage.title;
    this.goalYInput.value = this.editor.stage.goalY.toString();
    this.goalYSlider.value = this.editor.stage.goalY.toString();
    const sp = this.editor.getSpawnArea();
    this.spawnXInput.value = sp.x.toString();
    this.spawnYInput.value = sp.y.toString();
    this.spawnWInput.value = sp.width.toString();
    this.spawnHInput.value = sp.height.toString();
  }

  private renderLayout() {
    this.container.innerHTML = `
      <div class="map-editor-layout">
        <!-- 왼쪽: 캔버스 영역 -->
        <div class="editor-canvas-container">
          <canvas id="editorCanvas"></canvas>
          <div class="canvas-floating-controls">
            <button id="btnZoomIn" title="확대">+</button>
            <button id="btnZoomOut" title="축소">-</button>
            <button id="btnResetView" title="뷰 리셋">⌖</button>
          </div>
          <div class="canvas-hints">
            <span>🗺️ 미니맵: 클릭/드래그 이동</span>
            <span>🖱️ 휠: 상하 스크롤 (Ctrl+휠: 줌)</span>
            <span>🖐️ 드래그: 화면 이동</span>
            <span>⌨️ 방향키/PgUp/Dn: 화면 스크롤</span>
            <span>⌨️ Ctrl+Z/Y: 실행취소/다시실행</span>
            <span>📋 Ctrl+C/V: 복사/붙여넣기</span>
          </div>
          <div id="testModeBanner" class="test-mode-banner hide">
            <span>▶️ [테스트 플레이 진행 중]</span>
            <button id="btnStopTestBanner">편집으로 복귀</button>
          </div>
        </div>

        <!-- 오른쪽: 설정 및 아이템 팔레트 사이드바 -->
        <div class="editor-sidebar">
          <div class="sidebar-header">
            <h3>🛠️ 맵 에디터</h3>
            <button id="btnExitEditor" class="btn-primary" title="룰렛으로 돌아가서 플레이">
              <span>게임으로 가기 ➔</span>
            </button>
          </div>

          <!-- 상단 액션 버튼 그룹 -->
          <div class="sidebar-actions">
            <button id="btnTestPlay" class="btn-action btn-test">
              <span>▶️ 굴려보기</span>
            </button>
            <button id="btnShareLink" class="btn-action btn-share">
              <span>🔗 링크 복사</span>
            </button>
          </div>
          <div class="sidebar-actions secondary">
            <button id="btnUndo" class="btn-sub" title="실행 취소 (Ctrl+Z)">↩️ 실행 취소</button>
            <button id="btnRedo" class="btn-sub" title="다시 실행 (Ctrl+Y)">↪️ 다시 실행</button>
          </div>
          <div class="sidebar-actions tertiary">
            <button id="btnSaveJson" class="btn-sub">💾 JSON 다운로드</button>
            <label class="btn-sub file-label">
              📂 JSON 불러오기
              <input type="file" id="fileImportJson" accept=".json" style="display:none;" />
            </label>
          </div>

          <div class="sidebar-scrollable">
            <!-- 1. 맵 기본 설정 -->
            <div class="panel-section">
              <div class="section-title">🗺️ 맵 기본 설정</div>
              <div class="form-row">
                <label>맵 이름</label>
                <input type="text" id="inMapTitle" value="나만의 커스텀 맵" />
              </div>
              <div class="form-row">
                <label>골 라인 Y (길이)</label>
                <div class="range-with-num">
                  <input type="range" id="sliderGoalY" min="30" max="250" value="90" step="1" />
                  <input type="number" id="inGoalY" min="30" max="300" value="90" />
                </div>
              </div>
              <div class="form-row">
                <label>공식 맵 불러오기</label>
                <select id="sltOfficialMap">
                  <option value="">-- 공식 맵 템플릿 선택 --</option>
                  ${stages.map((st, i) => `<option value="${i}">${st.title}</option>`).join('')}
                </select>
              </div>
              <div class="form-row">
                <label>출발 영역 위치 (X, Y)</label>
                <div class="dual-inputs">
                  <input type="number" id="inSpawnX" step="0.25" value="9.25" />
                  <input type="number" id="inSpawnY" step="0.25" value="0.0" />
                </div>
              </div>
              <div class="form-row">
                <label>출발 영역 크기 (너비 × 높이)</label>
                <div class="dual-inputs">
                  <input type="number" id="inSpawnW" min="1" step="0.25" value="7.25" />
                  <input type="number" id="inSpawnH" min="1" step="0.25" value="6.0" />
                </div>
              </div>
              <div class="inspector-hint" style="margin-top: 6px;">
                💡 캔버스에서 <strong>출발 영역(민트색 박스)</strong>의 테두리를 잡고 드래그하면 크기와 위치를 직접 조절할 수 있습니다.
              </div>
            </div>

            <!-- 2. 드래그 앤 드롭 아이템 팔레트 -->
            <div class="panel-section">
              <div class="section-title">📦 아이템 배치 (캔버스로 드래그)</div>
              <div class="palette-grid">
                <div class="palette-item" draggable="true" data-type="pin">
                  <div class="palette-icon pin-icon">◆</div>
                  <div class="palette-label">고정 핀</div>
                </div>
                <div class="palette-item" draggable="true" data-type="spinner">
                  <div class="palette-icon spinner-icon">⟳</div>
                  <div class="palette-label">회전 막대</div>
                </div>
                <div class="palette-item" draggable="true" data-type="bubble">
                  <div class="palette-icon bubble-icon">●</div>
                  <div class="palette-label">튕김 버블</div>
                </div>
                <div class="palette-item" draggable="true" data-type="barrier">
                  <div class="palette-icon barrier-icon">━</div>
                  <div class="palette-label">안내 벽</div>
                </div>
              </div>
            </div>

            <!-- 3. 선택된 아이템 속성 인스펙터 -->
            <div class="panel-section inspector-section">
              <div class="section-title">⚙️ 선택 아이템 속성</div>
              <div id="inspectorContent" class="inspector-content">
                <div class="empty-hint">캔버스 위의 아이템을 클릭하거나, 위 목록에서 아이템을 드래그하여 배치하세요.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.titleInput = this.container.querySelector('#inMapTitle') as HTMLInputElement;
    this.goalYInput = this.container.querySelector('#inGoalY') as HTMLInputElement;
    this.goalYSlider = this.container.querySelector('#sliderGoalY') as HTMLInputElement;
    this.spawnXInput = this.container.querySelector('#inSpawnX') as HTMLInputElement;
    this.spawnYInput = this.container.querySelector('#inSpawnY') as HTMLInputElement;
    this.spawnWInput = this.container.querySelector('#inSpawnW') as HTMLInputElement;
    this.spawnHInput = this.container.querySelector('#inSpawnH') as HTMLInputElement;
    this.inspectorPanel = this.container.querySelector('#inspectorContent') as HTMLElement;
    this.testPlayBtn = this.container.querySelector('#btnTestPlay') as HTMLButtonElement;

    this.bindDomEvents();
  }

  private updateSpawnInputs() {
    const sp = this.editor.getSpawnArea();
    if (this.spawnXInput) this.spawnXInput.value = sp.x.toString();
    if (this.spawnYInput) this.spawnYInput.value = sp.y.toString();
    if (this.spawnWInput) this.spawnWInput.value = sp.width.toString();
    if (this.spawnHInput) this.spawnHInput.value = sp.height.toString();
  }

  private bindDomEvents() {
    // 맵 이름 변경
    this.titleInput.addEventListener('input', () => {
      this.editor.stage.title = this.titleInput.value || '무제 맵';
      this.editor.onStageChange?.(this.editor.stage);
    });

    // 골 라인 변경 (슬라이더 및 숫자 입력)
    const updateGoalY = (val: number) => {
      const v = Math.max(20, Math.min(300, val));
      this.goalYInput.value = v.toString();
      this.goalYSlider.value = v.toString();
      this.editor.stage.goalY = v;
      this.editor.stage.zoomY = Math.max(15, v - 5);
      this.editor.onStageChange?.(this.editor.stage);
    };

    this.goalYSlider.addEventListener('input', () => updateGoalY(parseFloat(this.goalYSlider.value)));
    this.goalYInput.addEventListener('change', () => updateGoalY(parseFloat(this.goalYInput.value) || 90));

    // 출발 영역 변경 핸들러
    const onSpawnInputChange = () => {
      const sp = this.editor.getSpawnArea();
      const x = parseFloat(this.spawnXInput.value);
      const y = parseFloat(this.spawnYInput.value);
      const w = Math.max(1, parseFloat(this.spawnWInput.value) || 1);
      const h = Math.max(1, parseFloat(this.spawnHInput.value) || 1);
      if (!Number.isNaN(x)) sp.x = x;
      if (!Number.isNaN(y)) sp.y = y;
      sp.width = w;
      sp.height = h;
      this.editor.stage.spawnArea = sp;
      this.editor.onStageChange?.(this.editor.stage);
    };

    this.spawnXInput.addEventListener('change', onSpawnInputChange);
    this.spawnYInput.addEventListener('change', onSpawnInputChange);
    this.spawnWInput.addEventListener('change', onSpawnInputChange);
    this.spawnHInput.addEventListener('change', onSpawnInputChange);

    // 공식 맵 불러와서 편집
    const sltOfficial = this.container.querySelector('#sltOfficialMap') as HTMLSelectElement;
    sltOfficial.addEventListener('change', (e) => {
      const idx = parseInt((e.target as HTMLSelectElement).value, 10);
      if (!Number.isNaN(idx) && stages[idx]) {
        if (confirm(`'${stages[idx].title}' 맵을 에디터로 불러오시겠습니까? 현재 작업 중인 내용은 대체됩니다.`)) {
          this.editor.setStage(stages[idx]);
          this.titleInput.value = `${this.editor.stage.title} (수정본)`;
          this.editor.stage.title = this.titleInput.value;
          updateGoalY(this.editor.stage.goalY);
          this.updateSpawnInputs();
          this.showToast(`'${stages[idx].title}' 맵을 불러왔습니다!`);
        }
        sltOfficial.value = ''; // 동일 맵 다시 선택 가능하도록 리셋
      }
    });

    // 팔레트 아이템 드래그 시작 설정
    const paletteItems = this.container.querySelectorAll('.palette-item');
    paletteItems.forEach((item) => {
      item.addEventListener('dragstart', (e: any) => {
        const type = item.getAttribute('data-type');
        const template = this.getTemplateData(type || 'pin');
        e.dataTransfer.setData('application/json', JSON.stringify(template));
      });
    });

    // 뷰포트 조작 플로팅 버튼
    this.container.querySelector('#btnZoomIn')?.addEventListener('click', () => {
      this.editor.zoom = Math.min(80, this.editor.zoom * 1.2);
    });
    this.container.querySelector('#btnZoomOut')?.addEventListener('click', () => {
      this.editor.zoom = Math.max(6, this.editor.zoom / 1.2);
    });
    this.container.querySelector('#btnResetView')?.addEventListener('click', () => {
      this.editor.viewX = 13;
      this.editor.viewY = Math.min(this.editor.stage.goalY / 2, 40);
      this.editor.zoom = 24;
    });

    // 테스트 플레이 토글 (비동기 안전 처리 및 로딩 상태 피드백)
    const toggleTestPlay = async () => {
      if (this.editor.isTesting) {
        this.editor.stopTestPlay();
        this.testPlayBtn.innerHTML = '<span>▶️ 굴려보기</span>';
        this.testPlayBtn.classList.remove('active');
        this.container.querySelector('#testModeBanner')?.classList.add('hide');
      } else {
        this.testPlayBtn.innerHTML = '<span>⏳ 구슬 준비 중...</span>';
        try {
          await this.editor.startTestPlay();
          this.testPlayBtn.innerHTML = '<span>⏹️ 테스트 정지</span>';
          this.testPlayBtn.classList.add('active');
          this.container.querySelector('#testModeBanner')?.classList.remove('hide');
        } catch (err: any) {
          console.error('Test play failed:', err);
          this.editor.stopTestPlay();
          this.testPlayBtn.innerHTML = '<span>▶️ 굴려보기</span>';
          this.testPlayBtn.classList.remove('active');
          alert(`굴려보기 실행 실패: ${err?.message || err}`);
        }
      }
    };

    this.testPlayBtn.addEventListener('click', toggleTestPlay);
    this.container.querySelector('#btnStopTestBanner')?.addEventListener('click', toggleTestPlay);

    // 실행 취소 / 다시 실행
    this.container.querySelector('#btnUndo')?.addEventListener('click', () => {
      this.editor.undo();
    });
    this.container.querySelector('#btnRedo')?.addEventListener('click', () => {
      this.editor.redo();
    });

    // 🔗 링크 복사 (URL Hash)
    this.container.querySelector('#btnShareLink')?.addEventListener('click', () => {
      saveCustomMapToLocal(this.editor.stage);
      const url = exportMapToUrl(this.editor.stage);
      navigator.clipboard
        .writeText(url)
        .then(() => {
          this.showToast('🔗 맵 공유 링크가 클립보드에 복사되었습니다!');
        })
        .catch(() => {
          prompt('아래 링크를 복사하세요:', url);
        });
    });

    // JSON 다운로드
    this.container.querySelector('#btnSaveJson')?.addEventListener('click', () => {
      exportMapToJsonFile(this.editor.stage);
      this.showToast('💾 JSON 파일이 다운로드되었습니다.');
    });

    // JSON 파일 불러오기
    const fileInput = this.container.querySelector('#fileImportJson') as HTMLInputElement;
    fileInput.addEventListener('change', async (e: any) => {
      const file = e.target?.files?.[0];
      if (file) {
        try {
          const loaded = await importMapFromJsonFile(file);
          this.editor.setStage(loaded);
          this.titleInput.value = loaded.title || '불러온 맵';
          updateGoalY(loaded.goalY);
          this.updateSpawnInputs();
          this.showToast('📂 맵을 성공적으로 불러왔습니다!');
        } catch (err: any) {
          alert(`맵 불러오기 실패: ${err.message}`);
        }
      }
    });

    // 게임으로 나가기
    this.container.querySelector('#btnExitEditor')?.addEventListener('click', () => {
      if (this.editor.isTesting) {
        this.editor.stopTestPlay();
      }
      saveCustomMapToLocal(this.editor.stage);
      this.onExitCallback(this.editor.stage);
    });
  }

  private bindEditorEvents() {
    this.editor.onSelectionChange = (entity, index) => {
      this.updateInspector(entity, index);
    };

    this.editor.onStageChange = (stage) => {
      this.titleInput.value = stage.title;
      this.goalYInput.value = stage.goalY.toString();
      this.goalYSlider.value = stage.goalY.toString();
      this.updateSpawnInputs();
    };

    this.editor.onToast = (msg) => {
      this.showToast(msg);
    };
  }

  private updateInspector(entity: MapEntity | null, index: number | null) {
    if (!entity || index === null) {
      this.inspectorPanel.innerHTML = `
        <div class="empty-hint">캔버스 위의 아이템을 클릭하거나, 위 목록에서 아이템을 드래그하여 배치하세요.</div>
      `;
      return;
    }

    const shape = entity.shape;
    const isBox = shape.type === 'box';
    const isCircle = shape.type === 'circle';
    const isKinematic = entity.type === 'kinematic';

    let html = `
      <div class="inspector-form">
        <div class="inspector-badge">
          선택: <strong>${isBox ? (isKinematic ? '회전 막대' : '네모 블록') : isCircle ? '버블 (원)' : '다각선 벽'}</strong>
        </div>

        <div class="form-row">
          <label>위치 (X, Y)</label>
          <div class="dual-inputs">
            <input type="number" id="inPosX" step="0.25" value="${entity.position.x}" />
            <input type="number" id="inPosY" step="0.25" value="${entity.position.y}" />
          </div>
        </div>
    `;

    if (isBox) {
      const box = shape as EntityBoxShape;
      html += `
        <div class="form-row">
          <label>크기 (너비 / 높이)</label>
          <div class="dual-inputs">
            <input type="number" id="inBoxW" min="0.1" step="0.1" value="${(box.width * 2).toFixed(1)}" />
            <input type="number" id="inBoxH" min="0.05" step="0.05" value="${(box.height * 2).toFixed(2)}" />
          </div>
        </div>
        <div class="form-row">
          <label>각도 (Rotation °)</label>
          <input type="number" id="inRotation" step="5" value="${box.rotation}" />
        </div>
        <div class="form-row">
          <label>동작 유형</label>
          <select id="sltBodyType">
            <option value="static" ${!isKinematic ? 'selected' : ''}>고정 (Static)</option>
            <option value="kinematic" ${isKinematic ? 'selected' : ''}>회전 (Kinematic)</option>
          </select>
        </div>
        <div class="inspector-hint">
          ${
            isKinematic
              ? '💡 캔버스에서 좌우/상하 핸들을 드래그하면 <strong>중심축이 고정된 채 대칭</strong>으로 크기가 조절됩니다.'
              : '💡 캔버스에서 4방향 핸들을 드래그하여 각 방향으로 크기를 조절할 수 있습니다.'
          }
        </div>
      `;
    } else if (isCircle) {
      const circle = shape as EntityCircleShape;
      html += `
        <div class="form-row">
          <label>반지름 (Radius)</label>
          <input type="number" id="inRadius" min="0.1" step="0.05" value="${circle.radius.toFixed(2)}" />
        </div>
        <div class="inspector-hint">
          💡 캔버스에서 <strong>외곽선 둘레를 드래그</strong>하면 중심이 고정된 채 반지름이 조절됩니다.
        </div>
      `;
    } else if (shape.type === 'polyline') {
      const poly = shape as EntityPolylineShape;
      html += `
        <div class="form-row">
          <label>정점(Point) 개수</label>
          <div style="font-weight: bold; color: #00e5ff; padding: 4px 0;">${poly.points.length}개</div>
        </div>
        <div class="form-row">
          <div class="dual-inputs">
            <button type="button" id="btnAddPolyPoint" class="btn-sub" style="flex:1;">+ 끝에 정점 추가</button>
            <button type="button" id="btnRemovePolyPoint" class="btn-sub" style="flex:1;" ${poly.points.length <= 2 ? 'disabled' : ''}>- 마지막 정점 삭제</button>
          </div>
        </div>
        <div class="inspector-hint">
          💡 캔버스에서 <strong>각 번호가 적힌 원형 정점</strong>을 직접 마우스로 드래그하여 벽의 위치와 모양을 자유롭게 바꿀 수 있습니다.<br>
          (선 위 더블클릭: 새 정점 삽입 / 정점 더블클릭: 삭제)
        </div>
      `;
    }

    if (isKinematic || (isBox && entity.type === 'kinematic')) {
      html += `
        <div class="form-row">
          <label>회전 속도 (rad/s)</label>
          <input type="number" id="inAngVel" step="0.5" value="${entity.props.angularVelocity || 0}" />
        </div>
      `;
    }

    html += `
      <div class="form-row">
        <label>탄성 (Restitution)</label>
        <input type="number" id="inRestitution" min="0" max="3" step="0.1" value="${entity.props.restitution ?? 0}" />
      </div>
      <div class="form-row">
        <label>소멸 횟수 (Life: -1은 무한)</label>
        <input type="number" id="inLife" min="-1" max="10" step="1" value="${entity.props.life ?? -1}" />
      </div>

      <div class="inspector-buttons">
        <button id="btnDuplicateItem" class="btn-sub">⧉ 복제 (Ctrl+D)</button>
        <button id="btnDeleteItem" class="btn-danger">🗑️ 삭제 (Del)</button>
      </div>
    </div>
    `;

    this.inspectorPanel.innerHTML = html;

    // 인스펙터 입력 바인딩
    this.inspectorPanel.querySelector('#inPosX')?.addEventListener('change', (e: any) => {
      entity.position.x = parseFloat(e.target.value) || 0;
    });
    this.inspectorPanel.querySelector('#inPosY')?.addEventListener('change', (e: any) => {
      entity.position.y = parseFloat(e.target.value) || 0;
    });

    if (isBox) {
      const box = shape as EntityBoxShape;
      this.inspectorPanel.querySelector('#inBoxW')?.addEventListener('change', (e: any) => {
        box.width = Math.max(0.05, (parseFloat(e.target.value) || 1) / 2);
      });
      this.inspectorPanel.querySelector('#inBoxH')?.addEventListener('change', (e: any) => {
        box.height = Math.max(0.025, (parseFloat(e.target.value) || 0.2) / 2);
      });
      this.inspectorPanel.querySelector('#inRotation')?.addEventListener('change', (e: any) => {
        box.rotation = parseFloat(e.target.value) || 0;
      });
      this.inspectorPanel.querySelector('#sltBodyType')?.addEventListener('change', (e: any) => {
        entity.type = e.target.value;
        if (entity.type === 'kinematic' && !entity.props.angularVelocity) {
          entity.props.angularVelocity = 3.5;
        }
        this.updateInspector(entity, index);
      });
    } else if (isCircle) {
      const circle = shape as EntityCircleShape;
      this.inspectorPanel.querySelector('#inRadius')?.addEventListener('change', (e: any) => {
        circle.radius = Math.max(0.05, parseFloat(e.target.value) || 0.25);
      });
    } else if (shape.type === 'polyline') {
      const poly = shape as EntityPolylineShape;
      this.inspectorPanel.querySelector('#btnAddPolyPoint')?.addEventListener('click', () => {
        const len = poly.points.length;
        if (len >= 2) {
          const pPrev = poly.points[len - 2];
          const pLast = poly.points[len - 1];
          const dx = pLast[0] - pPrev[0];
          const dy = pLast[1] - pPrev[1];
          poly.points.push([pLast[0] + (dx || 0), pLast[1] + (dy || 2)]);
        } else {
          poly.points.push([0, 2]);
        }
        this.updateInspector(entity, index);
        this.editor.onStageChange?.(this.editor.stage);
      });
      this.inspectorPanel.querySelector('#btnRemovePolyPoint')?.addEventListener('click', () => {
        if (poly.points.length > 2) {
          poly.points.pop();
          this.updateInspector(entity, index);
          this.editor.onStageChange?.(this.editor.stage);
        }
      });
    }

    this.inspectorPanel.querySelector('#inAngVel')?.addEventListener('change', (e: any) => {
      entity.props.angularVelocity = parseFloat(e.target.value) || 0;
    });
    this.inspectorPanel.querySelector('#inRestitution')?.addEventListener('change', (e: any) => {
      entity.props.restitution = Math.max(0, parseFloat(e.target.value) || 0);
    });
    this.inspectorPanel.querySelector('#inLife')?.addEventListener('change', (e: any) => {
      entity.props.life = parseInt(e.target.value, 10);
    });

    this.inspectorPanel.querySelector('#btnDuplicateItem')?.addEventListener('click', () => {
      this.editor.duplicateSelectedEntity();
    });
    this.inspectorPanel.querySelector('#btnDeleteItem')?.addEventListener('click', () => {
      this.editor.deleteSelectedEntity();
    });
  }

  private getTemplateData(type: string): DragTemplateData {
    switch (type) {
      case 'spinner':
        return {
          shapeType: 'box',
          entityType: 'kinematic',
          label: '회전 막대',
          defaultShape: {
            type: 'box',
            width: 1.5,
            height: 0.1,
            rotation: 0,
          },
          defaultProps: {
            density: 1,
            restitution: 0,
            angularVelocity: 3.5,
          },
        };
      case 'bubble':
        return {
          shapeType: 'circle',
          entityType: 'static',
          label: '튕김 버블',
          defaultShape: {
            type: 'circle',
            radius: 0.25,
          },
          defaultProps: {
            density: 1,
            restitution: 1.5,
            angularVelocity: 0,
            life: 1,
          },
        };
      case 'barrier':
        return {
          shapeType: 'box',
          entityType: 'static',
          label: '안내 벽',
          defaultShape: {
            type: 'box',
            width: 2.5,
            height: 0.15,
            rotation: 0,
          },
          defaultProps: {
            density: 1,
            restitution: 0,
            angularVelocity: 0,
          },
        };
      default:
        return {
          shapeType: 'box',
          entityType: 'static',
          label: '고정 핀',
          defaultShape: {
            type: 'box',
            width: 0.2,
            height: 0.2,
            rotation: 45,
          },
          defaultProps: {
            density: 1,
            restitution: 0.3,
            angularVelocity: 0,
          },
        };
    }
  }

  private showToast(msg: string) {
    const toast = document.createElement('div');
    toast.className = 'editor-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  public destroy() {
    this.editor.destroy();
    this.container.innerHTML = '';
  }
}
