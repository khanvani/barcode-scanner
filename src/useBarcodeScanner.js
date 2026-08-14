import { useCallback, useEffect, useRef, useState } from "react";
import { scanImageData, ZBarScanner, ZBarSymbolType, ZBarConfigType } from "@undecaf/zbar-wasm";

/**
 * Sewa-card barcode scanner (Code128 / Code39 / Code93 / QR).
 *
 * - Overlay is the aim box; decode also searches overlapping strips of the full view
 * - Left-biased crops skip the signature that sits beside Construction Sewa barcodes
 * - Never stop on an invalid decode — keep trying until a valid ID is found
 * - Native BarcodeDetector + ZBar; contrast stretch / binarize only as fallback
 */

export const SCAN_BAND_TOP = 0.34;
export const SCAN_BAND_HEIGHT = 0.30;
export const SCAN_BAND_LEFT = 0.08;
export const SCAN_BAND_WIDTH = 0.84;

const MAX_DECODE_WIDTH = 1920;
const MIN_DECODE_WIDTH = 1280;
const COOLDOWN_MS = 1500;
const REJECT_COOLDOWN_MS = 2500;

// Longer prefixes first so GNED wins over GN, and G last.
// Letters + digits only — hyphens, slashes, asterisks, etc. are rejected.
const VALID_BARCODE_RE = /^(GNED|AHM|GN|F|M|G|L)\d+$/;
const SPECIAL_CHAR_RE = /[^A-Z0-9]/;
// Longer first — peeled off before validate/store when the rest is a valid code.
const STRIP_WRAPPERS = ["Z3AHM", "AHM"];

const NATIVE_FORMATS = ["code_128", "code_39", "code_93", "codabar", "qr_code"];

const OVERLAY_WINDOW = {
  top: SCAN_BAND_TOP,
  height: SCAN_BAND_HEIGHT,
  left: SCAN_BAND_LEFT,
  width: SCAN_BAND_WIDTH,
};
const LEFT_SAFE = { left: 0.02, width: 0.76 };

/** Full-view strips so a barcode at the top, middle, or bottom still reads. */
const SEARCH_STRIPS = [
  { top: 0.04, height: 0.26, ...LEFT_SAFE },
  { top: 0.22, height: 0.26, ...LEFT_SAFE },
  { top: 0.40, height: 0.26, ...LEFT_SAFE },
  { top: 0.56, height: 0.28, ...LEFT_SAFE },
  { top: 0.68, height: 0.28, ...LEFT_SAFE },
];

let rotateIdx = 0;

export function useBarcodeScanner({ videoRef, onScan, onReject, onError, active, paused = false }) {
  const rafRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const trackRef = useRef(null);
  const scannerRef = useRef(null);
  const detectorRef = useRef(null);
  const lastScannedRef = useRef("");
  const lastRejectedRef = useRef("");
  const cooldownRef = useRef(null);
  const rejectCooldownRef = useRef(null);
  const scanningRef = useRef(false);
  const busyRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onRejectRef = useRef(onReject);
  const onErrorRef = useRef(onError);
  const pausedRef = useRef(paused);

  const [torch, setTorch] = useState({ supported: false, on: false });
  const [zoom, setZoom] = useState({ supported: false, min: 1, max: 1, value: 1 });

  useEffect(() => {
    onScanRef.current = onScan;
    onRejectRef.current = onReject;
    onErrorRef.current = onError;
    pausedRef.current = paused;
  });

  const stop = useCallback(() => {
    scanningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    clearTimeout(cooldownRef.current);
    clearTimeout(rejectCooldownRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    trackRef.current = null;
    if (scannerRef.current) {
      try {
        scannerRef.current.destroy();
      } catch {
        /* already destroyed */
      }
      scannerRef.current = null;
    }
    detectorRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorch({ supported: false, on: false });
    setZoom({ supported: false, min: 1, max: 1, value: 1 });
  }, [videoRef]);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      try {
        await track.applyConstraints({ torch: next });
        setTorch((t) => ({ ...t, on: next }));
      } catch {
        setTorch((t) => ({ ...t, on: false }));
      }
    }
  }, [torch.on]);

  const setZoomLevel = useCallback(async (value) => {
    const track = trackRef.current;
    if (!track) return;
    const caps = track.getCapabilities?.() || {};
    if (caps.zoom == null) return;
    const min = caps.zoom.min ?? 1;
    const max = caps.zoom.max ?? 1;
    const next = Math.min(max, Math.max(min, value));
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] });
      setZoom((z) => ({ ...z, value: next }));
    } catch {
      try {
        await track.applyConstraints({ zoom: next });
        setZoom((z) => ({ ...z, value: next }));
      } catch {
        /* zoom not actually writable */
      }
    }
  }, []);

  const focusAt = useCallback(
    async (clientX, clientY) => {
      const track = trackRef.current;
      const video = videoRef.current;
      if (!track || !video) return;
      const point = clientToVideoPoint(video, clientX, clientY);
      if (!point) return;
      const caps = track.getCapabilities?.() || {};
      if (!caps.pointsOfInterest && !caps.focusMode) return;

      const advanced = {};
      if (caps.pointsOfInterest) {
        advanced.pointsOfInterest = [{ x: point.x, y: point.y }];
      }
      if (caps.focusMode?.includes("single-shot")) {
        advanced.focusMode = "single-shot";
      } else if (caps.focusMode?.includes("manual")) {
        advanced.focusMode = "manual";
      }
      if (Object.keys(advanced).length === 0) return;
      try {
        await track.applyConstraints({ advanced: [advanced] });
      } catch {
        /* tap-to-focus not supported on this device */
      }
    },
    [videoRef],
  );

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    if ("webkitImageSmoothingEnabled" in ctx) {
      ctx.webkitImageSmoothingEnabled = false;
    }

    const start = async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        detectorRef.current = createNativeDetector();

        const track = stream.getVideoTracks()[0];
        trackRef.current = track;

        try {
          const caps = track.getCapabilities?.() || {};
          if (caps.focusMode?.includes("continuous")) {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
          }
          setTorch({ supported: Boolean(caps.torch), on: false });
          if (caps.zoom && caps.zoom.max > caps.zoom.min) {
            const current = track.getSettings?.().zoom ?? caps.zoom.min ?? 1;
            setZoom({
              supported: true,
              min: caps.zoom.min ?? 1,
              max: caps.zoom.max ?? 1,
              value: current,
            });
          } else {
            setZoom({ supported: false, min: 1, max: 1, value: 1 });
          }
        } catch {
          /* capabilities probe is best-effort */
        }

        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          /* autoplay can fail if the tab is backgrounded; frames still arrive */
        }

        if (cancelled) {
          stop();
          return;
        }

        scanningRef.current = true;
        lastScannedRef.current = "";
        lastRejectedRef.current = "";

        createZBarScanner()
          .then((scanner) => {
            if (cancelled) {
              scanner.destroy();
              return;
            }
            scannerRef.current = scanner;
          })
          .catch(() => {
            if (!detectorRef.current && !cancelled) {
              onErrorRef.current?.("Barcode engine failed to load.");
            }
          });

        const tick = () => {
          if (!scanningRef.current) return;
          rafRef.current = requestAnimationFrame(tick);

          if (busyRef.current || pausedRef.current) return;
          if (video.readyState < video.HAVE_ENOUGH_DATA) return;

          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) return;

          busyRef.current = true;

          Promise.resolve()
            .then(() => decodeFrame(video, canvas, ctx, vw, vh, scannerRef.current, detectorRef.current))
            .then((texts) => {
              if (!scanningRef.current || pausedRef.current) return;
              handleDecodedTexts(texts, {
                lastScannedRef,
                lastRejectedRef,
                cooldownRef,
                rejectCooldownRef,
                onScanRef,
                onRejectRef,
              });
            })
            .catch(() => {})
            .finally(() => {
              busyRef.current = false;
            });
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) {
          stream?.getTracks().forEach((t) => t.stop());
          return;
        }
        if (err?.name === "NotAllowedError") {
          onErrorRef.current?.("Camera permission denied. Please allow camera access.");
        } else if (err?.name === "NotFoundError") {
          onErrorRef.current?.("No camera found on this device.");
        } else {
          onErrorRef.current?.(err?.message || "Camera error");
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, videoRef, stop]);

  return {
    stop,
    torchSupported: torch.supported,
    torchOn: torch.on,
    toggleTorch,
    zoom,
    setZoomLevel,
    focusAt,
  };
}

/** Visible region of an object-fit:cover video, in source pixels. */
function getCoverVisibleRect(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const elW = video.clientWidth;
  const elH = video.clientHeight;
  if (!vw || !vh || !elW || !elH) {
    return {
      ox: 0,
      oy: 0,
      visW: vw,
      visH: vh,
      vw,
      vh,
    };
  }
  const scale = Math.max(elW / vw, elH / vh);
  const visW = elW / scale;
  const visH = elH / scale;
  return {
    ox: (vw - visW) / 2,
    oy: (vh - visH) / 2,
    visW,
    visH,
    vw,
    vh,
  };
}

function clientToVideoPoint(video, clientX, clientY) {
  const rect = video.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  const { ox, oy, visW, visH, vw, vh } = getCoverVisibleRect(video);
  if (!vw || !vh) return { x, y };
  return {
    x: (ox + x * visW) / vw,
    y: (oy + y * visH) / vh,
  };
}

async function createZBarScanner() {
  const scanner = await ZBarScanner.create();
  scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_ENABLE, 0);
  const enabled = [
    ZBarSymbolType.ZBAR_CODE128,
    ZBarSymbolType.ZBAR_CODE39,
    ZBarSymbolType.ZBAR_CODE93,
    ZBarSymbolType.ZBAR_CODABAR,
    ZBarSymbolType.ZBAR_QRCODE,
  ];
  for (const type of enabled) {
    scanner.setConfig(type, ZBarConfigType.ZBAR_CFG_ENABLE, 1);
    scanner.setConfig(type, ZBarConfigType.ZBAR_CFG_ASCII, 1);
  }
  scanner.setConfig(ZBarSymbolType.ZBAR_CODE128, ZBarConfigType.ZBAR_CFG_MIN_LEN, 2);
  scanner.setConfig(ZBarSymbolType.ZBAR_CODE39, ZBarConfigType.ZBAR_CFG_MIN_LEN, 4);
  scanner.setConfig(ZBarSymbolType.ZBAR_CODE93, ZBarConfigType.ZBAR_CFG_MIN_LEN, 4);
  scanner.setConfig(ZBarSymbolType.ZBAR_CODE128, ZBarConfigType.ZBAR_CFG_UNCERTAINTY, 0);
  scanner.setConfig(ZBarSymbolType.ZBAR_CODE39, ZBarConfigType.ZBAR_CFG_UNCERTAINTY, 0);
  scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_Y_DENSITY, 1);
  scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_X_DENSITY, 1);
  scanner.setConfig(ZBarSymbolType.ZBAR_NONE, ZBarConfigType.ZBAR_CFG_TEST_INVERTED, 1);
  scanner.enableCache(false);
  return scanner;
}

function createNativeDetector() {
  const Detector = globalThis.BarcodeDetector;
  if (typeof Detector === "undefined") return null;
  try {
    return new Detector({ formats: NATIVE_FORMATS });
  } catch {
    try {
      return new Detector();
    } catch {
      return null;
    }
  }
}

function scanAttemptsThisFrame() {
  const overlay = { ...OVERLAY_WINDOW, scale: 1, smooth: false, enhance: false };
  const overlayLeft = { ...OVERLAY_WINDOW, ...LEFT_SAFE, scale: 1, smooth: false, enhance: false };
  const extras = [
    ...SEARCH_STRIPS.map((s) => ({ ...s, scale: 1, smooth: false, enhance: false })),
    { ...OVERLAY_WINDOW, scale: 2, smooth: true, enhance: true },
    { top: 0.62, height: 0.34, ...LEFT_SAFE, scale: 2, smooth: true, enhance: true },
  ];
  const bottom = { top: 0.66, height: 0.30, ...LEFT_SAFE, scale: 1, smooth: false, enhance: false };
  const extra = extras[rotateIdx % extras.length];
  rotateIdx += 1;
  return [overlay, overlayLeft, bottom, extra];
}

async function decodeFrame(video, canvas, ctx, vw, vh, scanner, detector) {
  const vis = getCoverVisibleRect(video);
  const collected = [];

  for (const attempt of scanAttemptsThisFrame()) {
    const texts = await decodeCrop(video, canvas, ctx, vis, vw, vh, attempt, scanner, detector);
    if (!texts.length) continue;
    collected.push(...texts);
    if (textsIncludeAccepted(texts)) return collected;
  }
  return collected;
}

async function decodeCrop(video, canvas, ctx, vis, vw, vh, attempt, scanner, detector) {
  const visW = vis.visW || vw;
  const visH = vis.visH || vh;
  const left = attempt.left ?? 0;
  const width = attempt.width ?? 1;
  const sx = vis.ox + visW * left;
  const sy = vis.oy + visH * attempt.top;
  const sw = visW * width;
  const sh = visH * attempt.height;

  let dstW = Math.round(sw * attempt.scale);
  let dstH = Math.round(sh * attempt.scale);
  if (dstW > MAX_DECODE_WIDTH) {
    dstH = Math.round(dstH * (MAX_DECODE_WIDTH / dstW));
    dstW = MAX_DECODE_WIDTH;
  } else if (attempt.scale === 1 && dstW > 0 && dstW < MIN_DECODE_WIDTH) {
    dstH = Math.round(dstH * (MIN_DECODE_WIDTH / dstW));
    dstW = MIN_DECODE_WIDTH;
  }
  if (dstW < 1 || dstH < 1) return [];

  if (canvas.width !== dstW || canvas.height !== dstH) {
    canvas.width = dstW;
    canvas.height = dstH;
  }
  ctx.imageSmoothingEnabled = Boolean(attempt.smooth);
  if ("webkitImageSmoothingEnabled" in ctx) {
    ctx.webkitImageSmoothingEnabled = Boolean(attempt.smooth);
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dstW, dstH);
  const imageData = ctx.getImageData(0, 0, dstW, dstH);

  let texts = await decodeImage(imageData, canvas, scanner, detector);
  if (textsIncludeAccepted(texts) || !attempt.enhance) return texts;

  const stretched = cloneImageData(imageData);
  if (histogramStretch(stretched)) {
    ctx.putImageData(stretched, 0, 0);
    const extra = await decodeImage(stretched, canvas, scanner, detector);
    texts = mergeTexts(texts, extra);
    if (textsIncludeAccepted(texts)) return texts;
  }

  const binary = cloneImageData(imageData);
  if (binarizeImageData(binary)) {
    ctx.putImageData(binary, 0, 0);
    const extra = await decodeImage(binary, canvas, scanner, detector);
    texts = mergeTexts(texts, extra);
  }
  return texts;
}

async function decodeImage(imageData, canvas, scanner, detector) {
  const texts = [];

  if (detector) {
    try {
      const codes = await detector.detect(canvas);
      for (const code of codes) {
        if (code.rawValue) texts.push(code.rawValue);
      }
    } catch {
      /* native detector can throw on some frames */
    }
  }

  const nativeHasValid = texts.some((t) => isAcceptedBarcode(normalizeBarcode(t)));
  if (!nativeHasValid && scanner) {
    const symbols = await scanImageData(imageData, scanner);
    for (const symbol of symbols) {
      texts.push(symbol.decode());
    }
  }

  return texts;
}

function textsIncludeAccepted(texts) {
  if (!texts?.length) return false;
  return texts.some((t) => isAcceptedBarcode(normalizeBarcode(t)));
}

function mergeTexts(a, b) {
  if (!b?.length) return a;
  return a.length ? a.concat(b) : b;
}

function cloneImageData(src) {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

function handleDecodedTexts(texts, refs) {
  if (!texts?.length) return;

  const normalized = [];
  for (const raw of texts) {
    const text = normalizeBarcode(raw);
    if (text) normalized.push(text);
  }
  if (!normalized.length) return;

  const valid = normalized.find((t) => isAcceptedBarcode(t) && t !== refs.lastScannedRef.current);
  if (valid) {
    clearTimeout(refs.cooldownRef.current);
    refs.lastScannedRef.current = valid;
    refs.cooldownRef.current = setTimeout(() => {
      refs.lastScannedRef.current = "";
    }, COOLDOWN_MS);
    refs.onScanRef.current?.(valid);
    return;
  }

  const rejected = normalized.find((t) => !isAcceptedBarcode(t) && t !== refs.lastRejectedRef.current);
  if (rejected) {
    clearTimeout(refs.rejectCooldownRef.current);
    refs.lastRejectedRef.current = rejected;
    refs.rejectCooldownRef.current = setTimeout(() => {
      refs.lastRejectedRef.current = "";
    }, REJECT_COOLDOWN_MS);
    refs.onRejectRef.current?.(rejected);
  }
}

function normalizeBarcode(text) {
  if (!text) return "";
  let out = "";
  const raw = String(text).trim();
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) >= 32) out += raw[i];
  }
  const cleaned = out
    .replace(/^\][A-Z][0-9]/i, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/[\s\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g, "")
    .toUpperCase();
  return stripLeadingWrappers(cleaned);
}

/** Peel off wrappers like Z3AHM / AHM before validate/store when the rest is a valid code. */
function stripLeadingWrappers(text) {
  for (const wrapper of STRIP_WRAPPERS) {
    if (!text.startsWith(wrapper) || text.length <= wrapper.length) continue;
    const rest = text.slice(wrapper.length);
    if (rest && VALID_BARCODE_RE.test(rest) && !SPECIAL_CHAR_RE.test(rest)) {
      return rest;
    }
  }
  return text;
}

function isAcceptedBarcode(text) {
  if (!text || SPECIAL_CHAR_RE.test(text)) return false;
  return VALID_BARCODE_RE.test(text);
}

/**
 * Otsu threshold on luma. Helps washed-out PDF / screen barcodes.
 */
function binarizeImageData(imageData) {
  const d = imageData.data;
  const len = d.length;
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < len; i += 16) {
    const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    hist[y] += 1;
    count += 1;
  }
  if (count < 16) return false;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = count - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      threshold = t;
    }
  }

  for (let i = 0; i < len; i += 4) {
    const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    const v = y > threshold ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  return true;
}

/**
 * Stretch low-contrast frames. Skip noise (tiny range) and frames that
 * already span most of the histogram.
 */
function histogramStretch(imageData) {
  const d = imageData.data;
  const len = d.length;
  let lo = 255;
  let hi = 0;

  for (let i = 0; i < len; i += 16) {
    const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }

  const range = hi - lo;
  if (range < 8 || range > 160) return false;

  const factor = 255 / range;
  for (let i = 0; i < len; i += 4) {
    d[i] = clampByte((d[i] - lo) * factor);
    d[i + 1] = clampByte((d[i + 1] - lo) * factor);
    d[i + 2] = clampByte((d[i + 2] - lo) * factor);
  }
  return true;
}

function clampByte(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}
