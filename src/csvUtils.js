export function toCSV(rows) {
  const header = ['#', 'Barcode', 'Timestamp'];
  const lines = [
    header.join(','),
    ...rows.map((r, i) =>
      [`${i + 1}`, `"${r.barcode.replace(/"/g, '""')}"`, `"${r.timestamp}"`].join(',')
    ),
  ];
  return lines.join('\n');
}

export function downloadCSV(rows) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scans_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
