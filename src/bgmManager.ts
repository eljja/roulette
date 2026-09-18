/**
 * BGM Manager - YouTube IFrame API를 이용한 배경음악 관리
 * 비디오 ID: ccEyoqLA1LU
 */
export class BgmManager {
  private _player: any = null;
  private _videoId: string = 'ccEyoqLA1LU';
  private _isReady: boolean = false;
  private _isPlaying: boolean = false;
  private _isMuted: boolean = false;
  private _hasUserInteracted: boolean = false;
  private _volume: number = 50;
  private _container: HTMLElement | null = null;
  private _shouldPlay: boolean = true; // 진입하자마자 자동 재생 시도

  constructor() {
    this._isMuted = localStorage.getItem('mbr_bgm_muted') === 'true';
    this._initYouTubeAPI();
    this._setupAutoplayUnlock();
  }

  private _initYouTubeAPI() {
    // 뷰포트 내에 렌더링되게 하여 브라우저 백그라운드 스로틀링 방지 (투명도 0.001)
    this._container = document.createElement('div');
    this._container.id = 'bgm-player-container';
    this._container.style.cssText =
      'position:fixed;width:200px;height:200px;opacity:0.001;pointer-events:none;right:0;bottom:0;z-index:-9999;';
    document.body.appendChild(this._container);

    const playerDiv = document.createElement('div');
    playerDiv.id = 'bgm-youtube-player';
    this._container.appendChild(playerDiv);

    // YouTube IFrame API 스크립트 로드
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    // API 준비 완료 콜백
    const prevOnReady = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (prevOnReady) prevOnReady();
      this._createPlayer();
    };

    // 이미 API가 로드된 경우
    if ((window as any).YT?.Player) {
      this._createPlayer();
    }
  }

  private _createPlayer() {
    const YT = (window as any).YT;
    if (!YT?.Player) return;

    this._player = new YT.Player('bgm-youtube-player', {
      videoId: this._videoId,
      playerVars: {
        autoplay: 1, // 진입 즉시 자동 재생 요청
        loop: 1,
        playlist: this._videoId,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          this._isReady = true;
          this._player.setVolume(this._volume);
          if (this._isMuted) {
            this._player.mute();
          } else if (this._hasUserInteracted || this._shouldPlay) {
            this.play();
          }
        },
        onStateChange: (event: any) => {
          const YTState = (window as any).YT?.PlayerState;
          if (YTState && event.data === YTState.ENDED) {
            // 루프 재생
            this._player.seekTo(0);
            this._player.playVideo();
          }
          if (YTState && event.data === YTState.PLAYING) {
            this._isPlaying = true;
          } else if (YTState && (event.data === YTState.PAUSED || event.data === YTState.ENDED)) {
            this._isPlaying = false;
          }
        },
      },
    });
  }

  /**
   * 브라우저 자동 재생 정책 해제 핸들러: 화면 어느 곳이든 클릭, 터치, 키 입력 등 사용자 상호작용 발생 즉시 BGM 재생
   */
  private _setupAutoplayUnlock() {
    const unlockAndPlay = () => {
      this._hasUserInteracted = true;
      if (this._isMuted) return;
      this._shouldPlay = true;
      if (this._isReady && this._player && !this._isPlaying) {
        this.play();
      }
    };

    const events = [
      'pointerdown',
      'mousedown',
      'click',
      'keydown',
      'touchstart',
      'touchend',
      'wheel',
    ];
    events.forEach((evt) => {
      window.addEventListener(evt, unlockAndPlay, { passive: true });
    });
  }

  /** 재생 시작 */
  public play() {
    if (this._isMuted) return;
    this._shouldPlay = true;
    if (!this._isReady || !this._player) return;
    try {
      this._player.unMute();
      this._player.playVideo();
      this._isPlaying = true;
    } catch (e) {
      console.warn('Failed to play BGM:', e);
    }
  }

  /** 일시 정지 */
  public pause() {
    this._shouldPlay = false;
    if (!this._isReady || !this._player) return;
    this._player.pauseVideo();
    this._isPlaying = false;
  }

  /** 정지 */
  public stop() {
    this._shouldPlay = false;
    if (!this._isReady || !this._player) return;
    this._player.stopVideo();
    this._isPlaying = false;
  }

  /** 음소거 토글 */
  public toggleMute(): boolean {
    this._isMuted = !this._isMuted;
    localStorage.setItem('mbr_bgm_muted', String(this._isMuted));
    if (this._player && this._isReady) {
      if (this._isMuted) {
        this._player.mute();
        this._player.pauseVideo();
        this._isPlaying = false;
      } else {
        this._player.unMute();
        this._player.setVolume(this._volume);
        this._player.playVideo();
        this._isPlaying = true;
      }
    }
    return !this._isMuted;
  }

  public get isMuted(): boolean {
    return this._isMuted;
  }

  /** 볼륨 설정 (0 ~ 100) */
  public setVolume(vol: number) {
    this._volume = Math.max(0, Math.min(100, vol));
    if (this._isReady && this._player) {
      this._player.setVolume(this._volume);
    }
  }

  public get isPlaying() {
    return this._isPlaying;
  }
}
