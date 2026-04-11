import { useState, useCallback, useRef, useEffect } from 'react';
import { useBarcodeScanner } from './useBarcodeScanner';
import { useBeep } from './useBeep';
import { downloadCSV } from './csvUtils';
import './App.css';

export default function App() {
  const [scanning, setScanning] = useState(false);
  const [scans, setScans] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('barcode-scans') || '[]');
    } catch {
      return [];
    }
  });
  const [lastScan, setLastScan] = useState(null);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const beep = useBeep();

  // Auto-start on mount
  useEffect(() => {
    setScanning(true);
  }, []);

  const handleScan = useCallback(
    (barcode) => {
      setScans((prev) => {
        if (prev.some((s) => s.barcode === barcode)) return prev;
        beep();
        setLastScan(barcode);
        setError('');
        const next = [{ barcode, timestamp: new Date().toLocaleString() }, ...prev];
        localStorage.setItem('barcode-scans', JSON.stringify(next));
        return next;
      });
    },
    [beep]
  );

  const handleError = useCallback((msg) => {
    setError(msg);
    setScanning(false);
  }, []);

  useBarcodeScanner({
    videoRef,
    onScan: handleScan,
    onError: handleError,
    active: scanning,
  });

  const toggleScanner = () => {
    setError('');
    setLastScan(null);
    setScanning((v) => !v);
  };

  const clearScans = () => {
    setScans([]);
    setLastScan(null);
    localStorage.removeItem('barcode-scans');
  };

  return (
    <div className="app">
      <header className="app-header">
        <svg className="logo-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2" y="4" width="2" height="16" fill="currentColor" />
          <rect x="6" y="4" width="1" height="16" fill="currentColor" />
          <rect x="9" y="4" width="2" height="16" fill="currentColor" />
          <rect x="13" y="4" width="1" height="16" fill="currentColor" />
          <rect x="16" y="4" width="3" height="16" fill="currentColor" />
          <rect x="21" y="4" width="1" height="16" fill="currentColor" />
        </svg>
        <h1>Barcode Scanner</h1>
        <span className={`status-dot ${scanning ? 'live' : 'off'}`} title={scanning ? 'Live' : 'Stopped'} />
      </header>

      <main className="app-main">
        {/* ── Scanner ── */}
        <section className="scanner-card">
          <div className={`viewport-wrap ${scanning ? 'active' : ''}`}>
            <video
              ref={videoRef}
              className="scanner-video"
              autoPlay
              muted
              playsInline
            />
            {!scanning && (
              <div className="viewport-overlay">
                <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
                  <path d="M8 20V8h12M44 8h12v12M56 44v12H44M20 56H8V44"
                    stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <p>Camera paused</p>
              </div>
            )}
            {scanning && (
              <div className="scan-line" aria-hidden="true" />
            )}
          </div>

          {error && <p className="error-msg" role="alert">{error}</p>}

          {lastScan && (
            <div className="last-scan" aria-live="polite">
              <span className="last-scan-label">Last scan</span>
              <span className="last-scan-value">{lastScan}</span>
            </div>
          )}

          <button
            className={`btn-scan ${scanning ? 'btn-stop' : 'btn-start'}`}
            onClick={toggleScanner}
          >
            {scanning ? '⏹ Stop' : '▶ Start'}
          </button>
        </section>

        {/* ── Results ── */}
        <section className="results-card">
          <div className="results-header">
            <h2>
              Scanned Data
              {scans.length > 0 && <span className="badge">{scans.length}</span>}
            </h2>
            {scans.length > 0 && (
              <div className="results-actions">
                <button className="btn-export" onClick={() => downloadCSV(scans)}>
                  ⬇ Export CSV
                </button>
                <button className="btn-clear" onClick={clearScans}>
                  🗑 Clear
                </button>
              </div>
            )}
          </div>

          {scans.length === 0 ? (
            <p className="empty-msg">No scans yet — point camera at a barcode.</p>
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
    </div>
  );
}
