export function sourceRetryAfter(value: string | undefined, now: string): number {
  if (!value) return 60;
  if (/^\d+$/.test(value)) return Math.min(86400, Math.max(1, Number(value)));
  const seconds = Math.ceil((Date.parse(value) - Date.parse(now)) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, seconds) : 60;
}
