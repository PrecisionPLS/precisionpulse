// src/lib/time.ts

export const NY_TZ = "America/New_York";

/**
 * Returns YYYY-MM-DD in New York time
 */
export function nyISODate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns YYYY-MM-DD HH:mm:ss in New York time
 */
export function nyDateTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(date)
    .replace(" ", " ");
}

/**
 * Safely normalize any stored date to NY YYYY-MM-DD
 */
export function safeNYISODate(value?: string | null): string {
  if (!value) return nyISODate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? nyISODate() : nyISODate(d);
}
