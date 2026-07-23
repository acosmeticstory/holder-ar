/**
 * ScrollSequence — Apple AirPods 스타일 스크롤(swipe) 시퀀스 컴포넌트.
 *
 * 한 줄 요약:
 *   "사용자가 손가락으로 좌우로 끌면, 미리 로드된 N장의 이미지를 frame-by-frame으로
 *    canvas에 그려서 마치 동영상처럼 보이게 한다."
 *
 * 사용법:
 *   const seq = new ScrollSequence(containerEl, { basePath: 'frames/test' });
 *   const remoteSeq = new ScrollSequence(containerEl, {
 *     frameBase: 'https://cdn.example.com/frame-',
 *     frameCount: 121,
 *     preloadAll: false
 *   });
 *   await seq.init();
 *   ...
 *   seq.destroy();      // 모달 닫힐 때 메모리/이벤트 정리
 *
 * manifest.json 형식 (build-frames.cjs가 자동 생성):
 *   { count, width, frames: ['frame-001.webp', 'frame-002.webp', ...] }
 */
class ScrollSequence {
  constructor(container, options) {
    const config = options || {};
    this.container = container;
    this.basePath = config.basePath || '';
    this.frameBase = config.frameBase || '';
    this.frameCount = Math.max(0, Number(config.frameCount) || 0);
    this.framePad = Math.max(1, Number(config.framePad) || 3);
    this.frameExt = config.frameExt || 'webp';
    this.preloadRadius = Math.max(
      0,
      Object.prototype.hasOwnProperty.call(config, 'preloadRadius')
        ? Number(config.preloadRadius) || 0
        : 4
    );
    this.preloadAll = Object.prototype.hasOwnProperty.call(config, 'preloadAll')
      ? Boolean(config.preloadAll)
      : !this.frameBase;
    // 사용자가 화면 너비만큼 좌우로 끌면 처음 → 끝 (full sweep). 너비 절반 끌면 절반 진행.
    this.fullSweepRatio = config.fullSweepRatio || 1.0;
    // 내부 상태
    this.manifest = null;
    this.frames = [];          // Image() 객체 배열
    this.loadingFrames = new Map();
    this.loadedCount = 0;
    this.currentIdx = 0;
    this.canvas = null;
    this.ctx = null;
    this.dragStartX = null;
    this.dragStartIdx = 0;
    this.rafId = null;
    this.pendingIdx = null;
    this._onResize = null;
    this._destroyed = false;
  }

  async init() {
    // 1) 원격 frame 규칙이 있으면 바로 구성하고, 아니면 기존 manifest를 로드.
    if (this.frameBase && this.frameCount > 0) {
      this.manifest = { count: this.frameCount, frames: new Array(this.frameCount).fill('') };
    } else {
      const r = await fetch(`${this.basePath}/manifest.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`manifest fetch failed: HTTP ${r.status}`);
      this.manifest = await r.json();
    }

    if (!this.manifest || !Array.isArray(this.manifest.frames) || !this.manifest.frames.length) {
      throw new Error('frame list is empty');
    }

    this.frames = new Array(this.manifest.frames.length);

    // 2) canvas 만들고 컨테이너에 붙임
    this._setupCanvas();

    // 3) 제스처 바인딩 (canvas에 손가락 drag)
    this._bindGestures();

    // 4) 첫 장만 기다린 뒤 주변 frame을 백그라운드에서 준비.
    await this._loadFrame(0);

    // 5) 첫 frame 표시
    this._render(0);
    this._preloadAround(0);
    if (this.preloadAll) this._preloadRemaining();
  }

  _setupCanvas() {
    // 기존 콘텐츠 비우고 canvas만 남김
    this.container.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scroll-seq-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'pan-y';  // 세로 스크롤 허용, 가로는 우리가 처리
    this.canvas.style.cursor = 'grab';
    this.canvas.dataset.frameIndex = '0';
    this.canvas.dataset.frameLoaded = 'false';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // 컨테이너 크기에 맞게 canvas 실제 픽셀 크기 설정 (retina 대응)
    this._fitCanvas();
    this._onResize = () => this._fitCanvas();
    window.addEventListener('resize', this._onResize);
  }

  _fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    // 현재 frame 다시 그림 (크기 변경 후 깨끗하게)
    if (this.frames[this.currentIdx]) this._render(this.currentIdx);
  }

  _frameUrl(index) {
    if (this.frameBase) {
      const frame = String(index + 1).padStart(this.framePad, '0');
      return `${this.frameBase}${frame}.${this.frameExt}`;
    }
    return `${this.basePath}/${this.manifest.frames[index]}`;
  }

  _loadFrame(index) {
    if (this._destroyed || index < 0 || index >= this.manifest.frames.length) {
      return Promise.resolve(null);
    }

    const existing = this.frames[index];
    if (existing && existing.complete && existing.naturalWidth > 0) {
      return Promise.resolve(existing);
    }
    if (this.loadingFrames.has(index)) return this.loadingFrames.get(index);

    const promise = new Promise((resolve, reject) => {
      const img = existing || new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (this._destroyed) {
          resolve(null);
          return;
        }
        this.loadedCount++;
        this.frames[index] = img;
        resolve(img);
      };
      img.onerror = () => {
        if (this._destroyed) {
          resolve(null);
          return;
        }
        this.frames[index] = null;
        reject(new Error(`frame load failed: ${index + 1}`));
      };
      this.frames[index] = img;
      img.src = this._frameUrl(index);
    }).finally(() => this.loadingFrames.delete(index));

    this.loadingFrames.set(index, promise);
    return promise;
  }

  _preloadAround(index) {
    const start = Math.max(0, index - this.preloadRadius);
    const end = Math.min(this.manifest.frames.length - 1, index + this.preloadRadius);
    for (let i = start; i <= end; i++) {
      if (i === index) continue;
      this._loadFrame(i).catch(() => {});
    }
  }

  _preloadRemaining() {
    for (let i = 1; i < this.manifest.frames.length; i++) {
      this._loadFrame(i).catch(() => {});
    }
  }

  _bindGestures() {
    const onDown = (e) => {
      this.dragStartX = e.clientX;
      this.dragStartIdx = this.currentIdx;
      this.canvas.style.cursor = 'grabbing';
      try { this.canvas.setPointerCapture(e.pointerId); } catch(_) {}
      // 사용자가 잡았으니 깜빡임 힌트 즉시 끔
      this._clearIdleHint();
      this.container.classList.remove('hint-blink');
    };
    const onMove = (e) => {
      if (this.dragStartX == null) return;
      const dx = e.clientX - this.dragStartX;
      const sweepPx = this.container.getBoundingClientRect().width * this.fullSweepRatio;
      const total = this.manifest.frames.length;
      // 오른쪽으로 끌면 → 다음 frame, 왼쪽으로 끌면 → 이전. 비율 계산.
      const delta = Math.round((dx / sweepPx) * (total - 1));
      let next = this.dragStartIdx + delta;
      if (next < 0) next = 0;
      if (next > total - 1) next = total - 1;
      if (next !== this.currentIdx) this._scheduleRender(next);
    };
    const onUp = (e) => {
      this.dragStartX = null;
      this.canvas.style.cursor = 'grab';
      try { this.canvas.releasePointerCapture(e.pointerId); } catch(_) {}
      // 손 떼면 3초 idle 후 깜빡임 hint 다시 표시 → 사용자가 더 끌 수 있다는 안내
      this._scheduleIdleHint();
    };
    this.canvas.addEventListener('pointerdown', onDown);
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerup', onUp);
    this.canvas.addEventListener('pointercancel', onUp);
    this._handlers = { onDown, onMove, onUp };
  }

  _scheduleIdleHint() {
    this._clearIdleHint();
    this._idleTimer = setTimeout(() => {
      if (this._destroyed) return;
      // 첫 4초 intro fade가 끝났을 시점이라 hint-intro도 같이 제거. blink만 남김.
      this.container.classList.remove('hint-intro');
      this.container.classList.add('hint-blink');
    }, 3000);
  }
  _clearIdleHint() {
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
  }

  _scheduleRender(idx) {
    this.pendingIdx = idx;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const nextIdx = this.pendingIdx;
      this.pendingIdx = null;
      this._render(nextIdx);
    });
  }

  _render(idx) {
    if (this._destroyed) return;
    this.currentIdx = idx;
    this.canvas.dataset.frameIndex = String(idx);
    this.canvas.dataset.frameLoaded = 'false';
    const img = this.frames[idx];
    if (!img || !img.complete || img.naturalWidth === 0) {
      this._loadFrame(idx)
        .then(loaded => {
          if (!loaded || this._destroyed || this.currentIdx !== idx) return;
          this._drawFrame(loaded);
          this._preloadAround(idx);
        })
        .catch(e => console.warn('[scroll-sequence]', e.message));
      return;
    }
    this._drawFrame(img);
    this._preloadAround(idx);
  }

  _drawFrame(img) {
    // canvas 비율 유지하면서 contain 방식으로 그림 (이미지 잘림 방지)
    const cw = this.canvas.width, ch = this.canvas.height;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.drawImage(img, dx, dy, dw, dh);
    this.canvas.dataset.frameLoaded = 'true';
  }

  destroy() {
    this._destroyed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.pendingIdx = null;
    this._clearIdleHint();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.canvas && this._handlers) {
      this.canvas.removeEventListener('pointerdown', this._handlers.onDown);
      this.canvas.removeEventListener('pointermove', this._handlers.onMove);
      this.canvas.removeEventListener('pointerup', this._handlers.onUp);
      this.canvas.removeEventListener('pointercancel', this._handlers.onUp);
    }
    if (this.container) this.container.classList.remove('hint-intro', 'hint-blink');
    // 이미지 참조 끊어서 GC가 가져가도록
    this.frames = [];
    this.loadingFrames.clear();
    if (this.container) this.container.innerHTML = '';
  }
}

// 글로벌 노출 (index.html이 module 시스템 안 쓰니까)
window.ScrollSequence = ScrollSequence;
