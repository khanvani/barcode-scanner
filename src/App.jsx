import { useState, useCallback, useRef, useEffect } from 'react';
import { useBarcodeScanner, SCAN_BAND_TOP, SCAN_BAND_HEIGHT } from './useBarcodeScanner';
import { useBeep } from './useBeep';
import { downloadCSV } from './csvUtils';
import { version as appVersion } from '../package.json';
import { useInstallPrompt } from './useInstallPrompt';
import { nowISO, formatISTParts, scanTimeValue } from './timeUtils';
import {
  readLocalScans,
  persistScans,
  hydrateScans,
  mergeScanLists,
  readPending,
  clearPending,
  clearStoredScans,
} from './scanStore';
import './App.css';

export default function App() {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scans, setScans] = useState(() => readLocalScans());
  const [lastScan, setLastScan] = useState(null);
  const [camError, setCamError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [duplicateBarcode, setDuplicateBarcode] = useState(null);
  const [ackBarcode, setAckBarcode] = useState(null);
  const [rejectedBarcode, setRejectedBarcode] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusRing, setFocusRing] = useState(null);
  const { installPrompt, isInstalled, isIOS, triggerInstall } = useInstallPrompt();
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const videoRef = useRef(null);
  const menuRef = useRef(null);
  const scansRef = useRef(scans);
  const clearedRef = useRef(false);
  const focusTimerRef = useRef(null);
  const rejectTimerRef = useRef(null);
  const beep = useBeep();
  scansRef.current = scans;

  useEffect(() => {
    let cancelled = false;
    hydrateScans(scansRef.current).then((merged) => {
      if (cancelled || clearedRef.current || !merged.length) return;
      setScans((prev) => mergeScanLists(prev, merged));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const leftover = readPending();
    if (leftover) {
      setScans((prev) => {
        if (prev.some((s) => s.barcode === leftover)) {
          clearPending();
          return prev;
        }
        const next = [{ barcode: leftover, scannedAt: nowISO() }, ...prev];
        persistScans(next);
        clearPending();
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (scans.length === 0) return;
    persistScans(scans);
  }, [scans]);

  useEffect(() => {
    const flush = () => {
      if (scansRef.current.length) persistScans(scansRef.current);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menuOpen]);

  const handleScan = useCallback(
    (barcode) => {
      setRejectedBarcode(null);
      setScans((prev) => {
        if (prev.some((s) => s.barcode === barcode)) {
          setDuplicateBarcode(barcode);
          return prev;
        }
        const next = [{ barcode, scannedAt: nowISO() }, ...prev];
        const saved = persistScans(next);
        if (!saved) {
          setSaveError('Could not save to device storage. Export a CSV copy now — data is still on screen.');
        } else {
          setSaveError('');
        }
        beep();
        setLastScan(barcode);
        setAckBarcode(barcode);
        return next;
      });
    },
    [beep]
  );

  const handleReject = useCallback((barcode) => {
    setRejectedBarcode(barcode);
    clearTimeout(rejectTimerRef.current);
    rejectTimerRef.current = setTimeout(() => setRejectedBarcode(null), 2500);
  }, []);

  const handleCamError = useCallback((msg) => {
    setCamError(msg);
  }, []);

  const {
    torchSupported,
    torchOn,
    toggleTorch,
    zoom,
    setZoomLevel,
    focusAt,
  } = useBarcodeScanner({
    videoRef,
    onScan: handleScan,
    onReject: handleReject,
    onError: handleCamError,
    active: scannerOpen,
    paused: Boolean(duplicateBarcode) || Boolean(ackBarcode),
  });

  const openScanner = () => {
    setCamError('');
    setScannerOpen(true);
  };

  const closeScanner = () => {
    setScannerOpen(false);
    setRejectedBarcode(null);
    setAckBarcode(null);
    setFocusRing(null);
    setDuplicateBarcode(null);
    clearTimeout(focusTimerRef.current);
    clearTimeout(rejectTimerRef.current);
  };

  const dismissAck = () => {
    setAckBarcode(null);
  };

  const handleViewportTap = (e) => {
    if (e.target.closest('button')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setFocusRing({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    focusAt(e.clientX, e.clientY);
    clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusRing(null), 700);
  };

  const clearScans = () => {
    clearedRef.current = true;
    setScans([]);
    setLastScan(null);
    setAckBarcode(null);
    setSaveError('');
    clearStoredScans();
    setConfirmClear(false);
    setMenuOpen(false);
  };

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <svg className="logo-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2" y="4" width="2" height="16" fill="currentColor" />
          <rect x="6" y="4" width="1" height="16" fill="currentColor" />
          <rect x="9" y="4" width="2" height="16" fill="currentColor" />
          <rect x="13" y="4" width="1" height="16" fill="currentColor" />
          <rect x="16" y="4" width="3" height="16" fill="currentColor" />
          <rect x="21" y="4" width="1" height="16" fill="currentColor" />
        </svg>
        <div style={{ flex: 1 }}>
          <h1>Barcode Scanner</h1>
          <div className="header-brand">Scan. Track. Export.</div>
        </div>
        <div className="header-menu" ref={menuRef}>
          <button
            type="button"
            className="btn-header-cog"
            aria-label="Settings"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.5-2-3.5-2.4.5a8 8 0 0 0-1.7-1L15 3h-6l-.4 2.5a8 8 0 0 0-1.7 1L6.5 6 4.5 9.5 6.5 11a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.5 2.4-.5a8 8 0 0 0 1.7 1L9 21h6l.4-2.5a8 8 0 0 0 1.7-1l2.4.5 2-3.5-2-1.5Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {menuOpen && (
            <div className="header-menu-dropdown" role="menu">
              <button
                type="button"
                className="header-menu-item"
                role="menuitem"
                disabled={scans.length === 0}
                onClick={() => {
                  downloadCSV(scans);
                  setMenuOpen(false);
                }}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="header-menu-item header-menu-item-danger"
                role="menuitem"
                disabled={scans.length === 0}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmClear(true);
                }}
              >
                Clear all scans…
              </button>
              <div className="header-menu-version">Version {appVersion}</div>
            </div>
          )}
        </div>
      </header>

      {/* ── Install Banner ── */}
      {!isInstalled && !dismissedInstall && (installPrompt || isIOS) && (
        <div className="install-overlay" role="dialog" aria-modal="true" aria-label="Install App">
          <div className="install-sheet">
            <div className="install-sheet-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="2" y="4" width="2" height="16" fill="currentColor" />
                <rect x="6" y="4" width="1" height="16" fill="currentColor" />
                <rect x="9" y="4" width="2" height="16" fill="currentColor" />
                <rect x="13" y="4" width="1" height="16" fill="currentColor" />
                <rect x="16" y="4" width="3" height="16" fill="currentColor" />
                <rect x="21" y="4" width="1" height="16" fill="currentColor" />
              </svg>
            </div>
            <h3 className="install-sheet-title">Install Barcode Scanner</h3>
            <p className="install-sheet-desc">
              {isIOS
                ? <><strong>Tap the Share button</strong> in Safari, then select <strong>"Add to Home Screen"</strong> to install this app.</>
                : 'Add this app to your home screen for quick one-tap access — works offline too.'}
            </p>
            {isIOS && (
              <div className="install-ios-steps">
                <div className="install-ios-step">
                  <span className="install-ios-step-num">1</span>
                  <span>Tap the <strong>Share</strong> <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style={{ verticalAlign: 'middle' }} aria-hidden="true"><path d="M12 2v13M8 11l4 4 4-4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> icon in Safari's toolbar</span>
                </div>
                <div className="install-ios-step">
                  <span className="install-ios-step-num">2</span>
                  <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                </div>
                <div className="install-ios-step">
                  <span className="install-ios-step-num">3</span>
                  <span>Tap <strong>"Add"</strong> to confirm</span>
                </div>
              </div>
            )}
            <div className="install-sheet-actions">
              {!isIOS && (
                <button className="btn-install-confirm" onClick={triggerInstall}>
                  Install App
                </button>
              )}
              <button className="btn-install-dismiss" onClick={() => setDismissedInstall(true)}>
                No thanks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main page ── */}
      <main className="app-main">
        {saveError && (
          <div className="save-error" role="alert">
            {saveError}
            {scans.length > 0 && (
              <button type="button" className="btn-export" onClick={() => downloadCSV(scans)}>
                Export now
              </button>
            )}
          </div>
        )}

        {/* Scan button */}
        <div className="scan-trigger-wrap">
          <button className="btn-open-scanner" onClick={openScanner}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2" y="4" width="2" height="16" fill="currentColor" />
              <rect x="6" y="4" width="1" height="16" fill="currentColor" />
              <rect x="9" y="4" width="2" height="16" fill="currentColor" />
              <rect x="13" y="4" width="1" height="16" fill="currentColor" />
              <rect x="16" y="4" width="3" height="16" fill="currentColor" />
              <rect x="21" y="4" width="1" height="16" fill="currentColor" />
            </svg>
            Scan Barcode
          </button>
        </div>

        {/* Results card */}
        <section className="results-card">
          <div className="results-header">
            <h2>
              Scanned Data
              {scans.length > 0 && <span className="badge">{scans.length}</span>}
            </h2>
            {scans.length > 0 && (
              <button className="btn-export" onClick={() => downloadCSV(scans)}>
                Export
              </button>
            )}
          </div>

          {scans.length === 0 ? (
            <p className="empty-msg">No scans yet — press "Scan Barcode" to start.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="col-num">#</th>
                    <th>Barcode</th>
                    <th>Scanned At</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s, i) => {
                    const parts = formatISTParts(scanTimeValue(s));
                    return (
                      <tr key={`${s.barcode}-${s.scannedAt || s.timestamp || i}`} className={i === 0 ? 'row-new' : ''}>
                        <td className="num-cell">{scans.length - i}</td>
                        <td className="barcode-cell">{s.barcode}</td>
                        <td className="ts-cell">
                          <span className="ts-date">{parts.date}</span>
                          {parts.time ? <span className="ts-time">{parts.time}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* ── Scanner Modal ── */}
      {scannerOpen && (
        <div className="scanner-modal-overlay" role="dialog" aria-modal="true" aria-label="Barcode Scanner">
          <div className="scanner-modal">

            {/* Modal top bar */}
            <div className="scanner-modal-topbar">
              <div className="scanner-modal-meta">
                <span className="scanner-modal-count">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="14" height="14">
                    <rect x="2" y="4" width="2" height="16" fill="currentColor" />
                    <rect x="6" y="4" width="1" height="16" fill="currentColor" />
                    <rect x="9" y="4" width="2" height="16" fill="currentColor" />
                    <rect x="13" y="4" width="1" height="16" fill="currentColor" />
                    <rect x="16" y="4" width="3" height="16" fill="currentColor" />
                    <rect x="21" y="4" width="1" height="16" fill="currentColor" />
                  </svg>
                  {scans.length} scanned
                </span>
                {lastScan && (
                  <span className="scanner-modal-last" aria-live="polite">
                    <span className="scanner-modal-last-label">Last:</span>
                    <span className="scanner-modal-last-value">{lastScan}</span>
                  </span>
                )}
              </div>
              <button className="btn-close-scanner" onClick={closeScanner} aria-label="Close scanner">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Camera viewport */}
            <div className="scanner-modal-viewport" onClick={handleViewportTap}>
              <video ref={videoRef} className="scanner-video" autoPlay muted playsInline />
              <div
                className="decode-band"
                aria-hidden="true"
                style={{
                  top: `${SCAN_BAND_TOP * 100}%`,
                  height: `${SCAN_BAND_HEIGHT * 100}%`,
                }}
              >
                <div className="corner tl" />
                <div className="corner tr" />
                <div className="corner bl" />
                <div className="corner br" />
              </div>
              {focusRing && (
                <div
                  className="focus-ring"
                  style={{ left: focusRing.x, top: focusRing.y }}
                  aria-hidden="true"
                />
              )}
              <div className="scanner-controls">
                {torchSupported && (
                  <button
                    type="button"
                    className={`scanner-ctrl-btn${torchOn ? ' is-on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTorch();
                    }}
                    aria-pressed={torchOn}
                    aria-label={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M9 2h6l-1 5h3l-7 12 1-7H8L9 2z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
                {zoom.supported && (
                  <>
                    <button
                      type="button"
                      className="scanner-ctrl-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setZoomLevel(zoom.value - Math.max(0.1, (zoom.max - zoom.min) / 8));
                      }}
                      aria-label="Zoom out"
                      disabled={zoom.value <= zoom.min}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="scanner-ctrl-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setZoomLevel(zoom.value + Math.max(0.1, (zoom.max - zoom.min) / 8));
                      }}
                      aria-label="Zoom in"
                      disabled={zoom.value >= zoom.max}
                    >
                      +
                    </button>
                  </>
                )}
              </div>

              {camError && (
                <div className="scanner-modal-error" role="alert">{camError}</div>
              )}

              {rejectedBarcode && !ackBarcode && (
                <div className="scanner-modal-reject" role="status">
                  Read <strong>{rejectedBarcode}</strong> — only prefix + digits allowed, no special characters
                </div>
              )}

              {!ackBarcode && (
                <p className="scanner-modal-hint">Fill the red box with one barcode — zoom in if scanning a PDF</p>
              )}
            </div>

            {ackBarcode && (
              <div className="scanner-confirm-bar">
                <p className="scanner-ack-label">Scanned</p>
                <div className="scanner-confirm-value" aria-live="polite">{ackBarcode}</div>
                <button type="button" className="btn-scan-confirm" onClick={dismissAck} autoFocus>
                  OK
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Confirm Clear Modal ── */}
      {confirmClear && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="clear-title">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-icon modal-icon-warn">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 id="clear-title">Clear All Scans?</h3>
            </div>
            <div className="modal-body">
              <p>This will permanently delete all <strong>{scans.length}</strong> scanned record{scans.length !== 1 ? 's' : ''} from this device.</p>
              <p className="modal-warn">Export a CSV copy first. This cannot be undone.</p>
            </div>
            <div className="modal-footer modal-footer-clear">
              <div className="modal-footer-split">
                <button className="btn-modal-cancel" onClick={() => setConfirmClear(false)} autoFocus>
                  Cancel
                </button>
                <button
                  className="btn-modal-secondary"
                  onClick={() => downloadCSV(scans)}
                  disabled={scans.length === 0}
                >
                  Export
                </button>
              </div>
              <button className="btn-modal-danger" onClick={clearScans}>
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate Scan Modal ── */}
      {duplicateBarcode && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="dup-title">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-icon">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h3 id="dup-title">Already Scanned</h3>
            </div>
            <div className="modal-body">
              <p>This barcode has already been recorded in the current session.</p>
              <div className="modal-barcode">{duplicateBarcode}</div>
            </div>
            <div className="modal-footer">
              <button className="btn-modal-ok" onClick={() => setDuplicateBarcode(null)} autoFocus>
                OK, Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
