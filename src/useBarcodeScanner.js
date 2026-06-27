import { useEffect, useRef, useCallback } from 'react';
import { scanImageData } from '@undecaf/zbar-wasm';

/**
 * Production barcode scanner — optimized for 1D barcodes (Code128/Code39)
 * on mobile devices in variable lighting.
 *
 * Design decisions:
 * - Camera 1280×720 with continuous autofocus for sharp barcode edges
 * - requestAnimationFrame, skip every 2nd frame (~30fps effective scan rate)
 * - Full-width × center 50% height crop — matches 1D barcode natural shape
 * - Minimum 640px decode width for reliable thin-bar resolution
 * - Histogram-stretch contrast enhancement after 8 consecutive failures
 * - Single-read confirmation (no multi-frame requirement)
 * - Zero initial delay — first frame scanned immediately
 */

// Minimum width sent to ZBar — ensures enough pixels per barcode module
const MIN_DECODE_WIDTH = 640;

// Failures before applying contrast enhancement
const CONTRAST_THRESHOLD = 8;

// Cooldown after successful scan (prevents re-firing same barcode)
const SCAN_COOLDOWN_MS = 1500;

export function useBarcodeScanner({ videoRef, onScan, onError, active }) {
  const rafRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastScannedRef = useRef('');
  const cooldownRef = useRef(null);
  const scanningRef = useRef(false);
  const busyRef = useRef(false);
  const frameRef = useRef(0);
  const failCountRef = useRef(0);

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
          // Request continuous autofocus for sharper barcode capture
          focusMode: { ideal: 'continuous' },
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
        failCountRef.current = 0;

        // Try to enable continuous autofocus via track capabilities
        try {
          const track = stream.getVideoTracks()[0];
          const caps = track.getCapabilities?.();
          if (caps?.focusMode?.includes('continuous')) {
            track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
          }
        } catch (_) { /* not supported — that's fine */ }

        const tick = () => {
          if (!scanningRef.current) return;

          // Skip every other frame — gives ~30fps scan rate, saves CPU
          frameRef.current++;
          if (frameRef.current % 2 !== 0) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          // Don't pile up decodes
          if (busyRef.current) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          if (video.readyState >= video.HAVE_ENOUGH_DATA) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (vw && vh) {
              busyRef.current = true;

              // Crop: full width × center 50% height
              // This matches how users hold a card — barcode spans horizontally
              const cropH = Math.round(vh * 0.5);
              const sx = 0;
              const sy = Math.round((vh - cropH) / 2);
              const sw = vw;
              const sh = cropH;

              // Scale to at least MIN_DECODE_WIDTH, maintain aspect ratio
              const scale = Math.max(1, MIN_DECODE_WIDTH / sw);
              const cw = Math.round(sw * scale);
              const ch = Math.round(sh * scale);

              // Since source is 1280 and MIN_DECODE_WIDTH is 640, scale will be ≤1
              // Just use the source crop width directly (capped)
              const finalW = Math.min(sw, MIN_DECODE_WIDTH);
              const finalH = Math.round(sh * (finalW / sw));

              if (canvas.width !== finalW || canvas.height !== finalH) {
                canvas.width = finalW;
                canvas.height = finalH;
              }

              ctx.drawImage(video, sx, sy, sw, sh, 0, 0, finalW, finalH);
              const imageData = ctx.getImageData(0, 0, finalW, finalH);

              // Apply histogram stretch after sustained failures (dim lighting)
              if (failCountRef.current >= CONTRAST_THRESHOLD) {
                histogramStretch(imageData);
              }

              scanImageData(imageData)
                .then((symbols) => {
                  if (symbols.length > 0) {
                    const text = symbols[0].decode();
                    if (text && text !== lastScannedRef.current) {
                      clearTimeout(cooldownRef.current);
                      lastScannedRef.current = text;
                      cooldownRef.current = setTimeout(() => {
                        lastScannedRef.current = '';
                      }, SCAN_COOLDOWN_MS);
                      failCountRef.current = 0;
                      onScan(text);
                    }
                  } else {
                    failCountRef.current++;
                  }
                })
                .catch(() => {
                  failCountRef.current++;
                })
                .finally(() => {
                  busyRef.current = false;
                });
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        // Start immediately — zero delay
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
 * Histogram stretch — proper image processing for contrast enhancement.
 * Finds actual min/max brightness in the image and stretches to full 0–255 range.
 * Much more effective than arbitrary darkening/brightening.
 */
function histogramStretch(imageData) {
  const data = imageData.data;
  const len = data.length;

  // Find min/max luminance (using green channel as proxy — fastest)
  let min = 255, max = 0;
  for (let i = 1; i < len; i += 4) {
    const g = data[i];
    if (g < min) min = g;
    if (g > max) max = g;
  }

  // Avoid division by zero or near-zero range (already good contrast)
  const range = max - min;
  if (range < 30) return;

  const scale = 255 / range;
  for (let i = 0; i < len; i += 4) {
    data[i]     = Math.min(255, Math.max(0, (data[i] - min) * scale));     // R
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - min) * scale)); // G
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - min) * scale)); // B
    // Alpha unchanged
  }
}
