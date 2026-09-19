// App clock used across services for timestamps and time-based checks
// (e.g. the 24-hour rejection notice delay).

export const REJECTION_NOTICE_DELAY_MS = 24 * 60 * 60 * 1000;

export const nowMs = (): number => Date.now();

export const nowIso = (): string => new Date().toISOString();
