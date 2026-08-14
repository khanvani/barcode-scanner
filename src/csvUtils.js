import { formatIST, scanTimeValue } from './timeUtils';

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function istDateStamp() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function toCSV(rows) {
  const header = ['#', 'Barcode', 'Scanned At'];
  const lines = [
    header.join(','),
    ...rows.map((r, i) =>
      [`${i + 1}`, csvCell(r.barcode), csvCell(formatIST(scanTimeValue(r)))].join(',')
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export async function downloadCSV(rows) {
  if (!rows?.length) return;

  const csv = `\uFEFF${toCSV(rows)}`;
  const filename = `scans_${istDateStamp()}.csv`;
  const files = [
    new File([csv], filename, { type: 'text/csv' }),
    new File([csv], filename, { type: 'text/plain' }),
  ];

  let shareResult = 'unavailable';
  for (const file of files) {
    shareResult = await shareFile(file);
    if (shareResult !== 'unavailable') break;
  }

  // iPhone: the share sheet already includes Save to Files — a second
  // download would reopen the save/preview dialog they don't want.
  // Android/desktop: also save a copy to Downloads.
  if (isIOS() && shareResult !== 'unavailable') return;

  fallbackDownload(files[0], filename);
}

async function shareFile(file) {
  if (typeof navigator.share !== 'function') return 'unavailable';

  try {
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      return 'unavailable';
    }
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'abort';
    return 'unavailable';
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function fallbackDownload(file, filename) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}
