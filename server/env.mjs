import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

function parseEnvContent(content) {
  const result = {};
  const lines = String(content || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
      }
    } else {
      // Strip inline comment after whitespace for unquoted values
      const commentIdx = value.search(/\s+#/);
      if (commentIdx >= 0) {
        value = value.slice(0, commentIdx).trim();
      }
    }
    result[key] = value;
  }
  return result;
}

/**
 * Loads `.env` and `.env.local` once without overwriting environment variables
 * already provided by the host process or test runner.
 */
export function loadServerEnv(baseDir) {
  if (loaded) return;
  loaded = true;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = baseDir ? path.resolve(baseDir) : path.resolve(__dirname, "..");

  const envFiles = [".env", ".env.local"];
  const merged = {};
  for (const filename of envFiles) {
    const filePath = path.join(rootDir, filename);
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");
      Object.assign(merged, parseEnvContent(content));
    } catch {
      // Ignore unreadable env files
    }
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
