/**
 * Sound Manager - Web Audio API를 이용한 효과음 관리
 */
export class SoundManager {
  private _ctx: AudioContext | null = null;
  private _masterGain: GainNode | null = null;
  private _volume: number = 0.5;

  private _getCtx(): AudioContext {
    if (!this._ctx) {
      this._ctx = new AudioContext();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = this._volume;
      this._masterGain.connect(this._ctx.destination);
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  }

  private _play(buffer: AudioBuffer, offset = 0) {
    const ctx = this._getCtx();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this._masterGain!);
    src.start(ctx.currentTime + offset);
  }

  /** 구슬 충돌음 - 짧고 통통 튀는 소리 */
  public playBounce() {
    const ctx = this._getCtx();
    const duration = 0.08;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    const freq = 600 + Math.random() * 400;
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const envelope = Math.exp(-t * 40);
      data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
    }
    this._play(buffer);
  }

  /** 구슬 골인음 - 경쾌한 "딩동" 소리 */
  public playGoalIn() {
    const ctx = this._getCtx();
    const duration = 0.5;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    const freqs = [880, 1100];
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const envelope = Math.exp(-t * 5);
      let sample = 0;
      freqs.forEach((f, idx) => {
        sample += Math.sin(2 * Math.PI * f * t + idx * 0.3) * envelope * 0.3;
      });
      data[i] = sample;
    }
    this._play(buffer);
  }

  /** 우승 팡파르 - 밝고 화려한 승리 효과음 */
  public playFanfare() {
    const ctx = this._getCtx();
    const notes = [
      { freq: 523, start: 0, dur: 0.15 },    // C5
      { freq: 659, start: 0.15, dur: 0.15 }, // E5
      { freq: 784, start: 0.3, dur: 0.15 },  // G5
      { freq: 1047, start: 0.45, dur: 0.4 }, // C6
      { freq: 784, start: 0.65, dur: 0.15 }, // G5
      { freq: 1047, start: 0.8, dur: 0.6 },  // C6
    ];

    const totalDur = 1.4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * totalDur, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    notes.forEach(({ freq, start, dur }) => {
      const startSample = Math.floor(start * ctx.sampleRate);
      const endSample = Math.floor((start + dur) * ctx.sampleRate);
      for (let i = startSample; i < endSample && i < data.length; i++) {
        const t = (i - startSample) / ctx.sampleRate;
        const rel = t / dur;
        // ADSR envelope
        let env = 0;
        if (rel < 0.05) env = rel / 0.05;
        else if (rel < 0.3) env = 1.0;
        else if (rel < 0.5) env = 1.0 - (rel - 0.3) / 0.2 * 0.3;
        else env = 0.7 * (1.0 - (rel - 0.5) / 0.5);

        // 기본 사인파 + 2배음 추가로 화려하게
        data[i] += (Math.sin(2 * Math.PI * freq * t) * 0.5
                  + Math.sin(2 * Math.PI * freq * 2 * t) * 0.2
                  + Math.sin(2 * Math.PI * freq * 3 * t) * 0.1) * env;
      }
    });

    this._play(buffer);
  }

  /** 카운트다운 틱 음 */
  public playTick() {
    const ctx = this._getCtx();
    const duration = 0.05;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.exp(-t * 80);
      data[i] = Math.sin(2 * Math.PI * 1200 * t) * env * 0.3;
    }
    this._play(buffer);
  }

  /** 볼륨 설정 (0.0 ~ 1.0) */
  public setVolume(vol: number) {
    this._volume = Math.max(0, Math.min(1, vol));
    if (this._masterGain) {
      this._masterGain.gain.value = this._volume;
    }
  }

  /** AudioContext를 활성화 (첫 사용자 상호작용 시 호출) */
  public unlock() {
    this._getCtx();
  }
}
