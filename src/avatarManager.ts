const STORAGE_KEY = 'marble_face_avatars';

export class AvatarManager {
  private static imgCache: Map<string, HTMLImageElement> = new Map();

  public static getAll(): Record<string, string> {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  public static getAvatar(name: string): string | null {
    if (!name) return null;
    const cleanName = name.trim();
    const map = AvatarManager.getAll();
    return map[cleanName] || null;
  }

  public static setAvatar(name: string, dataUrl: string): void {
    if (!name) return;
    const cleanName = name.trim();
    const map = AvatarManager.getAll();
    map[cleanName] = dataUrl;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('Failed to save avatar to localStorage:', e);
    }
    AvatarManager.imgCache.delete(cleanName);
  }

  public static removeAvatar(name: string): void {
    if (!name) return;
    const cleanName = name.trim();
    const map = AvatarManager.getAll();
    delete map[cleanName];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('Failed to update localStorage after avatar removal:', e);
    }
    AvatarManager.imgCache.delete(cleanName);
  }

  public static hasAvatar(name: string): boolean {
    return !!AvatarManager.getAvatar(name);
  }

  /**
   * 클립보드 Blob을 받아 중앙 정사각형 크롭 & 160x160 원형 아바타로 리사이즈하여 DataURL 반환
   */
  public static async processImageBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        const size = 160;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context not available'));
          return;
        }

        // 중앙 정사각형 크롭 영역 계산 (증명사진 인물 중심)
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        // 원형 클리핑 영역
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        // 부드러운 이미지 축소 렌더링
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

        // WebP 압축 저장 (약 3~5KB)
        const dataUrl = canvas.toDataURL('image/webp', 0.88);
        resolve(dataUrl);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  /**
   * 렌더링용 HTMLImageElement 반환 (메모리 캐싱)
   */
  public static getImageElement(name: string): HTMLImageElement | null {
    if (!name) return null;
    const cleanName = name.trim();

    if (AvatarManager.imgCache.has(cleanName)) {
      return AvatarManager.imgCache.get(cleanName)!;
    }

    const dataUrl = AvatarManager.getAvatar(cleanName);
    if (!dataUrl) return null;

    const img = new Image();
    img.src = dataUrl;
    AvatarManager.imgCache.set(cleanName, img);
    return img;
  }
}
