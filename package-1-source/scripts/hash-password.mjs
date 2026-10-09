import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  process.stderr.write("Run this script in an interactive terminal so the password can be entered without echo.\n");
  process.exit(1);
}
process.stdout.write("Owner password (minimum 12 characters; input hidden): ");
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
let password = "";
let finished = false;
process.stdin.on("data", (chunk) => {
  for (const char of String(chunk)) {
    if (char === "\u0003") {
      process.stdout.write("\nCancelled.\n");
      process.exit(130);
    }
    if (char === "\r" || char === "\n") {
      if (finished) continue;
      finished = true;
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (password.length < 12) {
        process.stderr.write("Password must be at least 12 characters. No hash created.\n");
        process.exitCode = 1;
        return;
      }
      const salt = randomBytes(16);
      const hash = scryptSync(password, salt, 64);
      process.stdout.write("OWNER_PASSWORD_HASH=scrypt$" + salt.toString("hex") + "$" + hash.toString("hex") + "\n");
      password = "";
      return;
    }
    if (char === "\u007f" || char === "\b") {
      password = password.slice(0, -1);
      continue;
    }
    if (char >= " " && char !== "\u007f") password += char;
  }
});