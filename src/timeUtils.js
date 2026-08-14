const IST = 'Asia/Kolkata';

export function nowISO() {
  return new Date().toISOString();
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export function formatIST(value) {
  const date = toDate(value);
  if (!date) return value || '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

export function formatISTParts(value) {
  const date = toDate(value);
  if (!date) {
    const fallback = value || '—';
    return { date: fallback, time: '' };
  }
  const datePart = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
  return { date: datePart, time: timePart };
}

export function scanTimeValue(scan) {
  return scan?.scannedAt || scan?.timestamp || '';
}
