declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

/**
 * BGM Manager - YouTube IFrame API를 이용한 배경음악 관리
 * 비디오 ID: ccEyoqLA1LU (3D 핀볼 BGM OST)
 */
export class BgmManager {
  private _player: any = null;
  private _videoId: string = 'ccEyoqLA1LU';
  private _isReady: boolean = false;
  private _isPlaying: boolean = false;
  private _isMuted: boolean = false; // 기본값: BGM ON
  private _volume: number = 50; // 기본 볼륨 50%
  private _shouldPlay: boolean = true; // 진입하자마자 자동 재생 시도

  constructor() {
    this._isMuted = false;
    this._ensureContainer();
    this._initYouTubeAPI();
    this._setupAutoplayUnlock();
  }

  private _ensureContainer() {
    if (!document.getElementById('youtube-bgm-player')) {
      const wrapper = document.createElement('div');
      wrapper.id = 'youtube-bgm-wrapper';
      wrapper.style.cssText =
        'position:fixed;right:0;bottom:0;width:200px;height:200px;opacity:0.001;pointer-events:none;z-index:-9999;';
      const playerDiv = document.createElement('div');
      playerDiv.id = 'youtube-bgm-player';
      wrapper.appendChild(playerDiv);
      document.body.appendChild(wrapper);
    }
  }

  private _initYouTubeAPI() {
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScript = document.getElementsByTagName('script')[0];
      if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(tag, firstScript);
      } else {
        document.head.appendChild(tag);
      }
    }

    const prevOnReady = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (prevOnReady) prevOnReady();
      this._createPlayer();
    };

    if ((window as any).YT?.Player) {
      this._createPlayer();
    }
  }

  private _createPlayer() {
    const YT = (window as any).YT;
    if (!YT?.Player) return;
    if (this._player) return;

    const el = document.getElementById('youtube-bgm-player');
    if (!el) return;

    try {
      this._player = new YT.Player('youtube-bgm-player', {
        width: '200',
        height: '200',
        videoId: this._videoId,
        playerVars: {
          autoplay: 1, // 진입 즉시 자동 재생 요청
          loop: 1,
          playlist: this._videoId,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (event: any) => {
            this._isReady = true;
            this._player = event.target;
            this._player.setVolume(this._volume);
            if (!this._isMuted && this._shouldPlay) {
              try {
                this._player.unMute();
                this._player.playVideo();
              } catch (e) {
                console.warn('Initial autoplay blocked by browser policy:', e);
              }
            }
          },
          onStateChange: (event: any) => {
            const YTState = (window as any).YT?.PlayerState;
            if (YTState) {
              if (event.data === YTState.PLAYING) {
                this._isPlaying = true;
              } else if (event.data === YTState.PAUSED) {
                this._isPlaying = false;
              } else if (event.data === YTState.ENDED) {
                this._isPlaying = false;
                this._player?.seekTo(0);
                this._player?.playVideo();
              }
            }
          },
          onError: (event: any) => {
            console.warn('YouTube BGM Player error:', event.data);
          },
        },
      });
    } catch (err) {
      console.warn('Failed to create YouTube player:', err);
    }
  }

  /**
   * 브라우저 자동 재생 정책 해제: 페이지 진입 후 화면 어느 곳이든 마우스 이동, 휠, 클릭 등 감지 즉시 BGM 활성화
   */
  private _setupAutoplayUnlock() {
    const unlockAndPlay = () => {
      if (this._isMuted) return;
      this._shouldPlay = true;
      if (this._isReady && this._player && !this._isPlaying) {
        try {
          this._player.unMute();
          this._player.setVolume(this._volume);
          this._player.playVideo();
        } catch (e) {
          // 아직 브라우저 정책상 차단된 경우 계속 대기
        }
      }
    };

    const events = [
      'pointerdown',
      'mousedown',
      'click',
      'keydown',
      'touchstart',
      'wheel',
      'mousemove',
      'scroll',
    ];
    events.forEach((evt) => {
      window.addEventListener(evt, unlockAndPlay, { passive: true });
    });
  }

  public play() {
    if (this._isMuted) return;
    this._shouldPlay = true;
    if (!this._isReady || !this._player) return;
    try {
      this._player.unMute();
      this._player.setVolume(this._volume);
      this._player.playVideo();
    } catch (e) {
      console.warn('Failed to play BGM:', e);
    }
  }

  public pause() {
    this._shouldPlay = false;
    if (!this._isReady || !this._player) return;
    try {
      this._player.pauseVideo();
      this._isPlaying = false;
    } catch (e) {
      console.warn('Failed to pause BGM:', e);
    }
  }

  public stop() {
    this._shouldPlay = false;
    if (!this._isReady || !this._player) return;
    try {
      this._player.stopVideo();
      this._isPlaying = false;
    } catch (e) {
      console.warn('Failed to stop BGM:', e);
    }
  }

  public toggleMute(): boolean {
    this._isMuted = !this._isMuted;
    if (this._player && this._isReady) {
      if (this._isMuted) {
        this.pause();
      } else {
        this.play();
      }
    }
    return !this._isMuted;
  }

  public get isMuted(): boolean {
    return this._isMuted;
  }

  public set isMuted(val: boolean) {
    this._isMuted = val;
  }

  public setVolume(vol: number) {
    this._volume = Math.max(0, Math.min(100, vol));
    if (this._isReady && this._player) {
      this._player.setVolume(this._volume);
    }
  }

  public get isPlaying(): boolean {
    return this._isPlaying;
  }
}