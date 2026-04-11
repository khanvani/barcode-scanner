import { useState, useCallback, useRef } from 'react';
import { useBarcodeScanner } from './useBarcodeScanner';
import { useBeep } from './useBeep';
import { downloadCSV } from './csvUtils';
import { useInstallPrompt } from './useInstallPrompt';
import './App.css';

export default function App() {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scans, setScans] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('barcode-scans') || '[]');
    } catch {
      return [];
    }
  });
  const [lastScan, setLastScan] = useState(null);
  const [camError, setCamError] = useState('');
  const [duplicateBarcode, setDuplicateBarcode] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const { installPrompt, isInstalled, isIOS, triggerInstall } = useInstallPrompt();
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const videoRef = useRef(null);
  const beep = useBeep();

  const handleScan = useCallback(
    (barcode) => {
      setScans((prev) => {
        if (prev.some((s) => s.barcode === barcode)) {
          setDuplicateBarcode(barcode);
          return prev;
        }
        beep();
        setLastScan(barcode);
        const next = [{ barcode, timestamp: new Date().toLocaleString() }, ...prev];
        localStorage.setItem('barcode-scans', JSON.stringify(next));
        return next;
      });
    },
    [beep]
  );

  const handleCamError = useCallback((msg) => {
    setCamError(msg);
  }, []);

  useBarcodeScanner({
    videoRef,
    onScan: handleScan,
    onError: handleCamError,
    active: scannerOpen,
  });

  const openScanner = () => {
    setCamError('');
    setScannerOpen(true);
  };

  const closeScanner = () => {
    setScannerOpen(false);
  };

  const clearScans = () => {
    setScans([]);
    setLastScan(null);
    localStorage.removeItem('barcode-scans');
    setConfirmClear(false);
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
              <div className="results-actions">
                <button className="btn-export" onClick={() => downloadCSV(scans)}>
                  Export
                </button>
                <button className="btn-clear" onClick={() => setConfirmClear(true)}>
                  Clear
                </button>
              </div>
            )}
          </div>

          {scans.length === 0 ? (
            <p className="empty-msg">No scans yet — press "Scan Barcode" to start.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Barcode</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s, i) => (
                    <tr key={i} className={i === 0 ? 'row-new' : ''}>
                      <td className="num-cell">{scans.length - i}</td>
                      <td className="barcode-cell">{s.barcode}</td>
                      <td className="ts-cell">{s.timestamp}</td>
                    </tr>
                  ))}
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
            <div className="scanner-modal-viewport">
              <video ref={videoRef} className="scanner-video" autoPlay muted playsInline />
              <div className="scan-line" aria-hidden="true" />
              {/* Corner guides */}
              <div className="corner tl" aria-hidden="true" />
              <div className="corner tr" aria-hidden="true" />
              <div className="corner bl" aria-hidden="true" />
              <div className="corner br" aria-hidden="true" />
            </div>

            {camError && (
              <div className="scanner-modal-error" role="alert">{camError}</div>
            )}

            <p className="scanner-modal-hint">Point camera at a barcode to scan</p>
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
              <p>This will permanently delete all <strong>{scans.length}</strong> scanned record{scans.length !== 1 ? 's' : ''}. This action cannot be undone.</p>
            </div>
            <div className="modal-footer modal-footer-split">
              <button className="btn-modal-cancel" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button className="btn-modal-danger" onClick={clearScans} autoFocus>
                Yes, Clear All
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
