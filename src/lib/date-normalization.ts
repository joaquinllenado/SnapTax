function parseFromSlashOrDash(raw: string): Date | null {
  const mdy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    const date = new Date(year, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  const ymd = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!ymd) return null;

  const year = Number(ymd[1]);
  const month = Number(ymd[2]);
  const day = Number(ymd[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatDateMMDDYYYY(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

export function normalizeDateToMMDDYYYY(rawValue: string): string | null {
  const raw = rawValue.trim();
  if (!raw) return null;

  const slashOrDash = parseFromSlashOrDash(raw);
  if (slashOrDash) return formatDateMMDDYYYY(slashOrDash);

  const isoDatePrefix = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDatePrefix) {
    const date = parseFromSlashOrDash(
      `${isoDatePrefix[1]}-${isoDatePrefix[2]}-${isoDatePrefix[3]}`,
    );
    if (date) return formatDateMMDDYYYY(date);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateMMDDYYYY(parsed);
}
