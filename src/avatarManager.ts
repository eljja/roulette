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

  public static clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear avatars from localStorage:', e);
    }
    AvatarManager.imgCache.clear();
  }

  public static hasAvatar(name: string): boolean {
    return !!AvatarManager.getAvatar(name);
  }

  /**
   * 클립보드 Blob 또는 File을 받아 증명사진에 최적화된 스마트 크롭(얼굴 중심 줌인) & 160x160 원형 아바타로 리사이즈하여 DataURL 반환
   * @param blob 이미지 Blob
   * @param zoom 줌 배율 (기본 1.2배로 상반신 증명사진에서 얼굴이 원 안에 꽉 차도록 확대)
   * @param offsetYRatio 인물 얼굴 중심 세로 비율 (기본 0.43)
   */
  public static async processImageBlob(blob: Blob, zoom: number = 1.2, offsetYRatio: number = 0.43): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        const size = 320;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context not available'));
          return;
        }

        // 인물 얼굴 중심 증명사진 스마트 크롭 계산
        const baseCropSize = Math.min(img.width, img.height);
        const cropSize = baseCropSize / Math.max(0.5, Math.min(2.5, zoom));

        // 가로는 중앙, 세로는 인물 얼굴 중심(상단 42~45% 지점)
        const cx = img.width / 2;
        const cy = img.height * offsetYRatio;

        let sx = cx - cropSize / 2;
        let sy = cy - cropSize / 2;

        // 경계 제한 (클램프)
        if (sx < 0) sx = 0;
        if (sy < 0) sy = 0;
        if (sx + cropSize > img.width) sx = Math.max(0, img.width - cropSize);
        if (sy + cropSize > img.height) sy = Math.max(0, img.height - cropSize);

        // 원형 클리핑 영역 (전체 캔버스에 꽉 차게 클리핑하여 축소 착시 제거)
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        // 고품질 축소 렌더링
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, size, size);

        // 부드러운 테두리
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // WebP 압축 저장 (약 3~6KB)
        const dataUrl = canvas.toDataURL('image/webp', 0.9);
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
