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

export function downloadCSV(rows) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scans_${istDateStamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
