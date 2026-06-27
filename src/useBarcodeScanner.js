import { useEffect, useRef, useCallback } from 'react';
import { scanImageData } from '@undecaf/zbar-wasm';

// Scan interval in ms (~12 fps). Barcodes don't need 60fps detection.
const SCAN_INTERVAL_MS = 80;

export function useBarcodeScanner({ videoRef, onScan, onError, active }) {
  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastScannedRef = useRef('');
  const debounceRef = useRef(null);
  const scanningRef = useRef(false);

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

    // Reuse a single offscreen canvas
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let started = false;
    let lastCanvasW = 0;
    let lastCanvasH = 0;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          // 640×480 is plenty for barcode detection, reduces heat on mobile
          width: { ideal: 640 },
          height: { ideal: 480 },
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

        const tick = async () => {
          if (!scanningRef.current) return;

          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w && h) {
              // Downscale to max 640px wide
              const scale = Math.min(1, 640 / w);
              const cw = Math.round(w * scale);
              const ch = Math.round(h * scale);

              // Only resize canvas when dimensions change (avoids GPU stall)
              if (cw !== lastCanvasW || ch !== lastCanvasH) {
                canvas.width = cw;
                canvas.height = ch;
                lastCanvasW = cw;
                lastCanvasH = ch;
              }

              ctx.drawImage(video, 0, 0, cw, ch);
              const imageData = ctx.getImageData(0, 0, cw, ch);

              try {
                const symbols = await scanImageData(imageData);
                if (symbols.length > 0) {
                  const text = symbols[0].decode();
                  if (text && text !== lastScannedRef.current) {
                    clearTimeout(debounceRef.current);
                    lastScannedRef.current = text;
                    debounceRef.current = setTimeout(() => {
                      lastScannedRef.current = '';
                    }, 3000);
                    onScan(text);
                  }
                }
              } catch (_) {
                // no symbol in frame — normal, keep scanning
              }
            }
          }

          // Throttle: wait SCAN_INTERVAL_MS before next decode attempt
          timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
        };

        // Start first scan after a short delay to let video stabilize
        timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
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
