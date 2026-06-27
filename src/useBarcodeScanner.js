import { useEffect, useRef, useCallback } from 'react';
import { scanImageData } from '@undecaf/zbar-wasm';

// Scan every ~50ms (~20fps) — fast enough to feel instant, light enough for mobile
const SCAN_INTERVAL_MS = 50;

// Crop the center 60% of the frame — where the barcode actually is.
// This dramatically reduces pixel count while keeping decode accuracy high.
const CROP_RATIO = 0.6;

// Output canvas width for the cropped region (pixels sent to ZBar)
const SCAN_WIDTH = 600;

export function useBarcodeScanner({ videoRef, onScan, onError, active }) {
  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastScannedRef = useRef('');
  const debounceRef = useRef(null);
  const scanningRef = useRef(false);
  const busyRef = useRef(false);

  const stop = useCallback(() => {
    scanningRef.current = false;
    clearTimeout(timerRef.current);
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
          // 1280×720 gives the camera good focus & clarity for barcodes
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

        const tick = () => {
          if (!scanningRef.current) return;

          // Skip if previous decode is still in-flight (prevents pileup)
          if (busyRef.current) {
            timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
            return;
          }

          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (vw && vh) {
              // Crop center portion of the video frame
              const cropW = Math.round(vw * CROP_RATIO);
              const cropH = Math.round(vh * CROP_RATIO);
              const sx = Math.round((vw - cropW) / 2);
              const sy = Math.round((vh - cropH) / 2);

              // Scale cropped region to SCAN_WIDTH for consistent decode speed
              const aspect = cropH / cropW;
              const cw = SCAN_WIDTH;
              const ch = Math.round(SCAN_WIDTH * aspect);

              // Resize canvas only when needed
              if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw;
                canvas.height = ch;
              }

              // Draw only the center crop, scaled down
              ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cw, ch);
              const imageData = ctx.getImageData(0, 0, cw, ch);

              busyRef.current = true;
              scanImageData(imageData)
                .then((symbols) => {
                  if (symbols.length > 0) {
                    const text = symbols[0].decode();
                    if (text && text !== lastScannedRef.current) {
                      clearTimeout(debounceRef.current);
                      lastScannedRef.current = text;
                      debounceRef.current = setTimeout(() => {
                        lastScannedRef.current = '';
                      }, 2000);
                      onScan(text);
                    }
                  }
                })
                .catch(() => {
                  // no barcode found — normal
                })
                .finally(() => {
                  busyRef.current = false;
                });
            }
          }

          timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
        };

        // Begin scanning immediately
        timerRef.current = setTimeout(tick, 0);
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
