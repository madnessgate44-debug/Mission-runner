import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export function domainMatches(hostname: string, allowed: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const rule = allowed.toLowerCase().trim().replace(/\.$/, "");
  if (!host || !rule) return false;
  if (rule.startsWith("*.")) return host.endsWith(rule.slice(1)) && host !== rule.slice(2);
  return host === rule;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = ip.split(".").map(Number);
    return n[0] === 0 || n[0] === 10 || n[0] === 127 ||
      (n[0] === 169 && n[1] === 254) ||
      (n[0] === 172 && n[1]! >= 16 && n[1]! <= 31) ||
      (n[0] === 192 && n[1] === 168) ||
      (n[0] === 100 && n[1]! >= 64 && n[1]! <= 127) || n[0]! >= 224;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

export async function isAllowedUrl(raw: string, rules: string[]): Promise<boolean> {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host === "metadata.google.internal") return false;
  if (!rules.some(rule => domainMatches(host, rule))) return false;
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.length > 0 && records.every(record => !isPrivateIp(record.address));
  } catch { return false; }
}
