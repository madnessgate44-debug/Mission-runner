import { timingSafeEqual } from "node:crypto";

export function bearerTokenMatches(header: string | undefined, expected: string): boolean {
  if (!header || expected.length < 32) return false;
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match?.[1]) return false;
  const actual = Buffer.from(match[1]);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
