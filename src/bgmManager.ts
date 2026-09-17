/**
 * BGM Manager - YouTube IFrame API를 이용한 배경음악 관리
 * 비디오 ID: ccEyoqLA1LU
 */
export class BgmManager {
  private _player: any = null;
  private _videoId: string = 'ccEyoqLA1LU';
  private _isReady: boolean = false;
  private _isPlaying: boolean = false;
  private _volume: number = 50;
  private _container: HTMLElement | null = null;

  constructor() {
    this._initYouTubeAPI();
  }

  private _initYouTubeAPI() {
    // 숨겨진 플레이어 컨테이너 생성
    this._container = document.createElement('div');
    this._container.id = 'bgm-player-container';
    this._container.style.cssText =
      'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
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
    if ((window as any).YT && (window as any).YT.Player) {
      this._createPlayer();
    }
  }

  private _createPlayer() {
    const YT = (window as any).YT;
    if (!YT || !YT.Player) return;

    this._player = new YT.Player('bgm-youtube-player', {
      videoId: this._videoId,
      playerVars: {
        autoplay: 0,
        loop: 1,
        playlist: this._videoId,
        controls: 0,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          this._isReady = true;
          this._player.setVolume(this._volume);
        },
        onStateChange: (event: any) => {
          const YTState = (window as any).YT.PlayerState;
          if (event.data === YTState.ENDED) {
            // 루프 재생
            this._player.seekTo(0);
            this._player.playVideo();
          }
        },
      },
    });
  }

  /** 재생 시작 */
  public play() {
    if (!this._isReady || !this._player) return;
    this._player.playVideo();
    this._isPlaying = true;
  }

  /** 일시 정지 */
  public pause() {
    if (!this._isReady || !this._player) return;
    this._player.pauseVideo();
    this._isPlaying = false;
  }

  /** 정지 */
  public stop() {
    if (!this._isReady || !this._player) return;
    this._player.stopVideo();
    this._isPlaying = false;
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
