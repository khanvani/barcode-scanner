import { useEffect, useRef, useCallback } from 'react';
import { scanImageData } from '@undecaf/zbar-wasm';

/**
 * Fast barcode scanner for 1D codes (Code128, Code39, EAN, etc.)
 *
 * Key design:
 * - 1280×720 camera for good module resolution
 * - Scan every frame via rAF (busyRef prevents overlap naturally)
 * - Full-width horizontal band crop (center 40% height)
 * - Canvas at 640px wide — proven sweet spot for ZBar decode speed vs accuracy
 * - Histogram stretch kicks in after 10 consecutive failures
 * - Autofocus applied post-stream via track API (not in constraints — avoids OverconstrainedError)
 */

const DECODE_WIDTH = 640;
const CONTRAST_AFTER_FAILS = 10;
const COOLDOWN_MS = 1500;

// Valid barcode format: prefix (GNED, GN, F, M, G, L) followed by digits only.
// Order matters — GNED must be checked before GN (longer prefix first).
const VALID_BARCODE_RE = /^(GNED|GN|F|M|G|L)\d+$/;

export function useBarcodeScanner({ videoRef, onScan, onError, active }) {
  const rafRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastScannedRef = useRef('');
  const cooldownRef = useRef(null);
  const scanningRef = useRef(false);
  const busyRef = useRef(false);
  const failsRef = useRef(0);

  const stop = useCallback(() => {
    scanningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    clearTimeout(cooldownRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [videoRef]);

  useEffect(() => {
    if (!active || !videoRef.current) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let started = false;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      .then((stream) => {
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        video.play();
        started = true;
        scanningRef.current = true;
        failsRef.current = 0;

        // Enable continuous autofocus AFTER stream is acquired (safe approach)
        try {
          const track = stream.getVideoTracks()[0];
          const caps = track.getCapabilities?.();
          if (caps && caps.focusMode && caps.focusMode.includes('continuous')) {
            track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
          }
        } catch (_) {}

        const tick = () => {
          if (!scanningRef.current) return;

          // If previous decode hasn't finished, skip this frame (natural throttle)
          if (busyRef.current) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          if (video.readyState >= video.HAVE_ENOUGH_DATA) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (vw > 0 && vh > 0) {
              busyRef.current = true;

              // Crop center 40% height, full width — natural 1D barcode zone
              const bandH = Math.round(vh * 0.4);
              const sy = Math.round((vh - bandH) / 2);

              // Target canvas: DECODE_WIDTH × proportional height
              const aspect = bandH / vw;
              const cw = DECODE_WIDTH;
              const ch = Math.round(DECODE_WIDTH * aspect);

              if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw;
                canvas.height = ch;
              }

              ctx.drawImage(video, 0, sy, vw, bandH, 0, 0, cw, ch);
              const imageData = ctx.getImageData(0, 0, cw, ch);

              // Contrast help in dim lighting
              if (failsRef.current >= CONTRAST_AFTER_FAILS) {
                histogramStretch(imageData);
              }

              scanImageData(imageData)
                .then((symbols) => {
                  if (symbols.length > 0) {
                    const text = symbols[0].decode().trim();
                    // Only accept barcodes matching known format
                    if (text && VALID_BARCODE_RE.test(text) && text !== lastScannedRef.current) {
                      clearTimeout(cooldownRef.current);
                      lastScannedRef.current = text;
                      cooldownRef.current = setTimeout(() => {
                        lastScannedRef.current = '';
                      }, COOLDOWN_MS);
                      failsRef.current = 0;
                      onScan(text);
                    } else {
                      failsRef.current++;
                    }
                  } else {
                    failsRef.current++;
                  }
                })
                .catch(() => {
                  failsRef.current++;
                })
                .finally(() => {
                  busyRef.current = false;
                });
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err) => {
        if (err?.name === 'NotAllowedError') {
          onError?.('Camera permission denied. Please allow camera access.');
        } else if (err?.name === 'NotFoundError') {
          onError?.('No camera found on this device.');
        } else {
          onError?.(err?.message || 'Camera error');
        }
      });

    return () => {
      if (started) stop();
    };
  }, [active, videoRef, onScan, onError, stop]);

  return { stop };
}

/**
 * Histogram stretch — finds actual min/max brightness and maps to full 0–255 range.
 * Only the green channel is sampled to find range (fastest), then all RGB are stretched.
 */
function histogramStretch(imageData) {
  const d = imageData.data;
  const len = d.length;
  let lo = 255, hi = 0;

  // Sample every 4th pixel for speed (still statistically accurate)
  for (let i = 1; i < len; i += 16) {
    const v = d[i]; // green channel
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  const range = hi - lo;
  if (range < 40) return; // already decent contrast

  const factor = 255 / range;
  for (let i = 0; i < len; i += 4) {
    d[i]     = ((d[i] - lo) * factor) | 0;
    d[i + 1] = ((d[i + 1] - lo) * factor) | 0;
    d[i + 2] = ((d[i + 2] - lo) * factor) | 0;
  }
}
