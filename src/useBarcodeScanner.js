import { useEffect, useRef, useCallback } from 'react';
import { scanImageData } from '@undecaf/zbar-wasm';

/**
 * High-speed barcode scanner.
 *
 * Strategy for fast detection:
 * 1. Use requestAnimationFrame (no throttle) — scan as fast as the device allows
 * 2. Guard against overlapping decodes with a busy flag
 * 3. Scan a THIN horizontal strip (center band) — only ~50px tall
 *    For 1D barcodes (Code128/Code39) this is all ZBar needs and it's 10x faster
 *    than scanning a full square crop
 * 4. Every 5th frame, try a larger center square as fallback for 2D codes
 * 5. Camera at 1280×720 for good autofocus
 */

// Horizontal strip: 400px wide × 50px tall = 20,000 pixels (vs 360,000 for a square crop)
const STRIP_WIDTH = 400;
const STRIP_HEIGHT = 50;

// Square fallback for 2D codes: 300×300 = 90,000 pixels
const SQUARE_SIZE = 300;

// Try square crop every Nth frame
const SQUARE_EVERY_N = 5;

export function useBarcodeScanner({ videoRef, onScan, onError, active }) {
  const rafRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastScannedRef = useRef('');
  const debounceRef = useRef(null);
  const scanningRef = useRef(false);
  const busyRef = useRef(false);
  const frameCountRef = useRef(0);

  const stop = useCallback(() => {
    scanningRef.current = false;
    cancelAnimationFrame(rafRef.current);
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
        if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        video.play();
        started = true;
        scanningRef.current = true;

        const decode = (imageData) => {
          return scanImageData(imageData).then((symbols) => {
            if (symbols.length > 0) {
              const text = symbols[0].decode();
              if (text && text !== lastScannedRef.current) {
                clearTimeout(debounceRef.current);
                lastScannedRef.current = text;
                debounceRef.current = setTimeout(() => {
                  lastScannedRef.current = '';
                }, 1500);
                onScan(text);
                return true;
              }
            }
            return false;
          }).catch(() => false);
        };

        const tick = () => {
          if (!scanningRef.current) return;

          if (busyRef.current) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          if (video.readyState >= video.HAVE_ENOUGH_DATA) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (vw && vh) {
              busyRef.current = true;
              frameCountRef.current++;

              const useSquare = (frameCountRef.current % SQUARE_EVERY_N === 0);

              let cw, ch, sx, sy, sw, sh;

              if (useSquare) {
                // Square center crop for 2D barcodes
                const cropSize = Math.min(vw, vh) * 0.5;
                sx = Math.round((vw - cropSize) / 2);
                sy = Math.round((vh - cropSize) / 2);
                sw = Math.round(cropSize);
                sh = Math.round(cropSize);
                cw = SQUARE_SIZE;
                ch = SQUARE_SIZE;
              } else {
                // Thin horizontal strip across center — ultra fast for 1D barcodes
                const stripW = vw * 0.8;
                const stripH = vw * 0.05; // ~5% of width as height
                sx = Math.round((vw - stripW) / 2);
                sy = Math.round((vh - stripH) / 2);
                sw = Math.round(stripW);
                sh = Math.round(stripH);
                cw = STRIP_WIDTH;
                ch = STRIP_HEIGHT;
              }

              if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw;
                canvas.height = ch;
              }

              ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
              const imageData = ctx.getImageData(0, 0, cw, ch);

              decode(imageData).finally(() => {
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
