import LZString from 'lz-string';
import type { StageDef } from '../data/maps';

const LOCAL_STORAGE_KEY = 'mbr_custom_maps';

/**
 * 맵 객체를 LZ-string 압축하여 URL Hash 문자열(#map=...)로 변환
 */
export function exportMapToUrl(stage: StageDef): string {
  const jsonStr = JSON.stringify(stage);
  const compressed = LZString.compressToEncodedURIComponent(jsonStr);
  const url = new URL(window.location.href);
  url.hash = `map=${compressed}`;
  return url.toString();
}

/**
 * URL 또는 Hash 문자열에서 맵 객체를 압축 해제하여 복원
 */
export function importMapFromUrl(urlOrHash?: string): StageDef | null {
  const hash = urlOrHash || window.location.hash;
  if (!hash) return null;

  const match = hash.match(/#map=([^&]+)/);
  if (!match || !match[1]) return null;

  try {
    const decompressed = LZString.decompressFromEncodedURIComponent(match[1]);
    if (!decompressed) return null;
    const stage = JSON.parse(decompressed) as StageDef;
    if (stage && typeof stage.goalY === 'number' && Array.isArray(stage.entities)) {
      return stage;
    }
  } catch (e) {
    console.error('Failed to parse map from URL hash:', e);
  }
  return null;
}

/**
 * JSON 파일로 다운로드
 */
export function exportMapToJsonFile(stage: StageDef) {
  const jsonStr = JSON.stringify(stage, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeTitle = (stage.title || 'custom_map').replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, '_');
  a.href = url;
  a.download = `roulette_map_${safeTitle}.json`;
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * JSON 파일 업로드 파싱
 */
export function importMapFromJsonFile(file: File): Promise<StageDef> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const stage = JSON.parse(text) as StageDef;
        if (stage && typeof stage.goalY === 'number') {
          resolve(stage);
        } else {
          reject(new Error('올바른 맵 데이터 형식이 아닙니다.'));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsText(file);
  });
}

/**
 * 브라우저 로컬 저장소에 커스텀 맵 저장
 */
export function saveCustomMapToLocal(stage: StageDef) {
  try {
    const existing = loadCustomMapsFromLocal();
    const idx = existing.findIndex((m) => m.title === stage.title);
    if (idx >= 0) {
      existing[idx] = stage;
    } else {
      existing.push(stage);
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error('Failed to save custom map to localStorage', e);
  }
}

/**
 * 브라우저 로컬 저장소에서 커스텀 맵 목록 불러오기
 */
export function loadCustomMapsFromLocal(): StageDef[] {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Failed to load custom maps from localStorage', e);
  }
  return [];
}
