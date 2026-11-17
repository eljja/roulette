import assert from 'node:assert/strict';
import test from 'node:test';

function createEventTargetStub() {
  const listeners = new Map<string, Set<Function>>();
  return {
    listeners,
    addEventListener(type: string, fn: Function, opts?: any) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          listeners.get(type)?.delete(fn);
        });
      }
    },
    removeEventListener(type: string, fn: Function) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(type: string, event: any = {}) {
      for (const fn of listeners.get(type) ?? []) {
        fn(event);
      }
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

test('parseName trims name whitespace and rejects empty/modifier-only inputs', async () => {
  const { parseName } = await import('../src/utils/utils');
  assert.deepEqual(parseName('철수 /2'), { name: '철수', weight: 2, count: 1 });
  assert.deepEqual(parseName('영희 *3'), { name: '영희', weight: 1, count: 3 });
  assert.equal(parseName('   *3'), null);
  assert.equal(parseName('/2'), null);
});

test('options.autoRecording defaults to false matching UI checkbox', async () => {
  const { default: options } = await import('../src/options');
  assert.equal(options.autoRecording, false);
});

test('BgmManager does not restart playback on mousemove/click after stop() or pause()', async () => {
  const winTarget = createEventTargetStub();
  let playCalls = 0;
  let stopCalls = 0;

  (globalThis as any).window = {
    addEventListener: winTarget.addEventListener.bind(winTarget),
    removeEventListener: winTarget.removeEventListener.bind(winTarget),
    YT: {
      PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
      Player: class {
        constructor(_id: string, opts: any) {
          setTimeout(() => opts.events.onReady({ target: this }), 0);
        }
        setVolume() {}
        unMute() {}
        playVideo() {
          playCalls++;
        }
        pauseVideo() {}
        stopVideo() {
          stopCalls++;
        }
        seekTo() {}
      },
    },
  };
  (globalThis as any).document = {
    getElementById: (id: string) => (id === 'youtube-bgm-player' ? {} : null),
    getElementsByTagName: () => [],
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
  };

  const { BgmManager } = await import('../src/bgmManager');
  const bgm = new BgmManager();
  await new Promise((r) => setTimeout(r, 10));

  const callsAfterInit = playCalls;
  bgm.stop();
  assert.equal(stopCalls, 1);

  // Moving mouse or clicking after stop() must NOT resurrect BGM
  winTarget.dispatchEvent('mousemove', {});
  winTarget.dispatchEvent('click', {});
  assert.equal(playCalls, callsAfterInit, 'BGM should not resume on mousemove/click after stop()');
});

test('MapEditor.destroy() removes all window event listeners', async () => {
  const winTarget = createEventTargetStub();
  const canvasTarget = createEventTargetStub();
  (globalThis as any).window = {
    addEventListener: winTarget.addEventListener.bind(winTarget),
    removeEventListener: winTarget.removeEventListener.bind(winTarget),
    devicePixelRatio: 1,
  };
  (globalThis as any).document = {
    activeElement: null,
    querySelectorAll: () => [],
  };
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};

  const canvasStub = {
    width: 800,
    height: 600,
    style: {},
    getContext: () => ({
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      clip() {},
      setLineDash() {},
      fillText() {},
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: canvasTarget.addEventListener.bind(canvasTarget),
    removeEventListener: canvasTarget.removeEventListener.bind(canvasTarget),
  } as any;

  const { MapEditor } = await import('../src/editor/mapEditor');
  const editor = new MapEditor(canvasStub);
  assert.ok(winTarget.listenerCount('keydown') > 0);
  assert.ok(winTarget.listenerCount('mousemove') > 0);

  editor.destroy();
  assert.equal(winTarget.listenerCount('keydown'), 0, 'keydown listener leaked after destroy()');
  assert.equal(winTarget.listenerCount('mousemove'), 0, 'mousemove listener leaked after destroy()');
  assert.equal(winTarget.listenerCount('mouseup'), 0, 'mouseup listener leaked after destroy()');
  assert.equal(winTarget.listenerCount('resize'), 0, 'resize listener leaked after destroy()');
});

test('VideoRecorder handles unsupported MediaRecorder safely and detects supported MIME type', async () => {
  delete (globalThis as any).MediaRecorder;
  delete (globalThis as any).HTMLCanvasElement;

  const { VideoRecorder } = await import('../src/utils/videoRecorder');
  assert.equal(VideoRecorder.isSupported(), false);

  const canvasStub = {} as any; // No captureStream
  assert.doesNotThrow(() => new VideoRecorder(canvasStub));
});
