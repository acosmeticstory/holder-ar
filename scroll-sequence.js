/**
 * ScrollSequence — Apple AirPods 스타일 스크롤(swipe) 시퀀스 컴포넌트.
 *
 * 한 줄 요약:
 *   "사용자가 손가락으로 좌우로 끌면, 미리 로드된 N장의 이미지를 frame-by-frame으로
 *    canvas에 그려서 마치 동영상처럼 보이게 한다."
 *
 * 사용법:
 *   const seq = new ScrollSequence(containerEl, { basePath: 'frames/test' });
 *   await seq.init();   // manifest 로드 + 모든 frame preload + canvas 그리기 시작
 *   ...
 *   seq.destroy();      // 모달 닫힐 때 메모리/이벤트 정리
 *
 * manifest.json 형식 (build-frames.cjs가 자동 생성):
 *   { count, width, frames: ['frame-001.webp', 'frame-002.webp', ...] }
 */
class ScrollSequence {
  constructor(container, options) {
    this.container = container;
    this.basePath = (options && options.basePath) || '';
    // 사용자가 화면 너비만큼 좌우로 끌면 처음 → 끝 (full sweep). 너비 절반 끌면 절반 진행.
    this.fullSweepRatio = (options && options.fullSweepRatio) || 1.0;
    // 내부 상태
    this.manifest = null;
    this.frames = [];          // Image() 객체 배열
    this.loadedCount = 0;
    this.currentIdx = 0;
    this.canvas = null;
    this.ctx = null;
    this.dragStartX = null;
    this.dragStartIdx = 0;
    this.rafId = null;
    this._onResize = null;
    this._destroyed = false;
  }

  async init() {
    // 1) manifest 로드 — 몇 장인지, 파일명 패턴 파악
    const r = await fetch(`${this.basePath}/manifest.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`manifest fetch failed: HTTP ${r.status}`);
    this.manifest = await r.json();

    // 2) canvas 만들고 컨테이너에 붙임
    this._setupCanvas();

    // 3) 제스처 바인딩 (canvas에 손가락 drag)
    this._bindGestures();

    // 4) frame preload — 모든 이미지를 메모리에 미리 로드 (~2MB)
    //    첫 장은 await로 기다리고 즉시 그림. 나머지는 background.
    await this._preloadAll();

    // 5) 첫 frame 표시
    this._render(0);
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

  async _preloadAll() {
    const total = this.manifest.frames.length;
    this.frames = new Array(total);

    // 첫 장만 await로 — 사용자에게 즉시 보여줘야 하니까
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.frames[0] = img; this.loadedCount = 1; resolve(); };
      img.onerror = reject;
      img.src = `${this.basePath}/${this.manifest.frames[0]}`;
    });

    // 나머지는 background에서 비동기 로드. 사용자가 swipe하면서 점차 채워짐.
    for (let i = 1; i < total; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (this._destroyed) return;
        this.loadedCount++;
      };
      img.src = `${this.basePath}/${this.manifest.frames[i]}`;
      this.frames[i] = img;
    }
  }

  _bindGestures() {
    const onDown = (e) => {
      this.dragStartX = e.clientX;
      this.dragStartIdx = this.currentIdx;
      this.canvas.style.cursor = 'grabbing';
      try { this.canvas.setPointerCapture(e.pointerId); } catch(_) {}
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
    };
    this.canvas.addEventListener('pointerdown', onDown);
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerup', onUp);
    this.canvas.addEventListener('pointercancel', onUp);
    this._handlers = { onDown, onMove, onUp };
  }

  _scheduleRender(idx) {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this._render(idx);
    });
  }

  _render(idx) {
    if (this._destroyed) return;
    this.currentIdx = idx;
    const img = this.frames[idx];
    if (!img || !img.complete) return;
    // canvas 비율 유지하면서 contain 방식으로 그림 (이미지 잘림 방지)
    const cw = this.canvas.width, ch = this.canvas.height;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.drawImage(img, dx, dy, dw, dh);
  }

  destroy() {
    this._destroyed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.canvas && this._handlers) {
      this.canvas.removeEventListener('pointerdown', this._handlers.onDown);
      this.canvas.removeEventListener('pointermove', this._handlers.onMove);
      this.canvas.removeEventListener('pointerup', this._handlers.onUp);
      this.canvas.removeEventListener('pointercancel', this._handlers.onUp);
    }
    // 이미지 참조 끊어서 GC가 가져가도록
    this.frames = [];
    if (this.container) this.container.innerHTML = '';
  }
}

// 글로벌 노출 (index.html이 module 시스템 안 쓰니까)
window.ScrollSequence = ScrollSequence;
