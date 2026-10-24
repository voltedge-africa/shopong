import type { Money } from "@shopong/ports";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Rand amount in words people read: `R4 180.00`. Integer minor units in, no Intl (Hermes). */
export function formatZar(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const rand = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, " ");
  return `${sign}R${rand}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatMoney(money: Money): string {
  if (money.currency !== "ZAR") return `${money.currency} ${String(money.minor)}`;
  return formatZar(money.minor);
}

/** South Africa Standard Time is UTC+2 all year (no daylight saving). */
const SAST_OFFSET_MS = 2 * 3_600_000;

/** `24 Jan 2026` in South African time. */
export function formatDate(epochMs: number): string {
  const d = new Date(epochMs + SAST_OFFSET_MS);
  return `${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? "?"} ${String(d.getUTCFullYear())}`;
}

/** `24 Jan 2026, 09:30` in South African time. */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs + SAST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(epochMs)}, ${hh}:${mm}`;
}

export const SHORT_ID_LENGTH = 8;

/** First 8 hex characters of an event id, the short form shown to people. */
export function shortId(eventId: string): string {
  return eventId.slice(0, SHORT_ID_LENGTH);
}

export function pluralise(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
