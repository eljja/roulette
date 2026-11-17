import { pad } from './utils';

export class VideoRecorder {
  private targetCanvas: HTMLCanvasElement;
  private mediaRecorder: MediaRecorder | null = null;
  private videoStream: MediaStream | null = null;
  private selectedMimeType: string = 'video/webm';
  private fileExtension: string = 'webm';

  private chunks: Blob[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.targetCanvas = canvas;
  }

  public static isSupported(): boolean {
    return (
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof (HTMLCanvasElement.prototype as any).captureStream === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  public get isRecording() {
    return this.mediaRecorder?.state === 'recording';
  }

  public async start() {
    if (this.isRecording) return;
    if (!VideoRecorder.isSupported()) return;

    try {
      if (!this.videoStream) {
        this.videoStream = this.targetCanvas.captureStream();
      }

      if (MediaRecorder.isTypeSupported('video/mp4')) {
        this.selectedMimeType = 'video/mp4';
        this.fileExtension = 'mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        this.selectedMimeType = 'video/webm;codecs=vp9';
        this.fileExtension = 'webm';
      } else {
        this.selectedMimeType = 'video/webm';
        this.fileExtension = 'webm';
      }

      this.mediaRecorder = new MediaRecorder(this.videoStream, {
        mimeType: this.selectedMimeType,
        videoBitsPerSecond: 6000000,
      });

      return new Promise<void>((rs, rj) => {
        if (!this.mediaRecorder) return rs();
        this.chunks = [];
        this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) {
            this.chunks.push(e.data);
          }
        };
        this.mediaRecorder.onstop = () => {
          if (this.chunks.length === 0) return;
          const blob = new Blob(this.chunks, { type: this.selectedMimeType });
          const videoUrl = URL.createObjectURL(blob);
          const downloadLink = document.createElement('a');
          const d = new Date();

          downloadLink.href = videoUrl;
          downloadLink.download = `marble_roulette_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${this.fileExtension}`;
          downloadLink.click();
          downloadLink.remove();
          setTimeout(() => URL.revokeObjectURL(videoUrl), 1000);
        };
        this.mediaRecorder.onstart = () => {
          rs();
        };
        this.mediaRecorder.onerror = (err) => {
          rj(err);
        };
        this.mediaRecorder.start();
      });
    } catch (err) {
      console.warn('Failed to start VideoRecorder:', err);
    }
  }

  public stop() {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }
}
