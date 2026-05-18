/**
 * Minimal cURL command parser sufficient for the GUI's "Import cURL" action.
 *
 * Handles shell-style quoting (single and double), backslash line continuations,
 * common flag forms (-X, --request, -H, --header, -d, --data, --data-raw,
 * --data-binary, -u, --user, --url), and a positional URL. Intentionally does
 * NOT handle -F/--form, --data-urlencode, @file, or -b/--cookie — those need
 * multipart or file access that the Endpoints page's Send path can't replay.
 */

export type ParsedCurl = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  basicAuth?: { username: string; password: string };
  warnings: string[];
};

export type ParseResult = { ok: true; value: ParsedCurl } | { ok: false; error: string };

export function parseCurl(input: string): ParseResult {
  const joined = input.replace(/\\\n/g, " ").trim();
  if (!joined) return { ok: false, error: "empty input" };
  const tokens = tokenize(joined);
  if (tokens.length === 0) return { ok: false, error: "empty input" };
  let i = 0;
  if (tokens[0] === "curl") i = 1;

  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let basicAuth: ParsedCurl["basicAuth"];
  const warnings: string[] = [];

  const takeValue = (flag: string): string | undefined => {
    const next = tokens[++i];
    if (next === undefined) {
      warnings.push(`${flag} is missing its value`);
      return undefined;
    }
    return next;
  };

  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok === "-X" || tok === "--request") {
      const v = takeValue(tok);
      if (v) method = v.toUpperCase();
    } else if (tok === "-H" || tok === "--header") {
      const v = takeValue(tok);
      if (v) {
        const idx = v.indexOf(":");
        if (idx > 0) {
          const k = v.slice(0, idx).trim();
          const val = v.slice(idx + 1).trim();
          headers[k] = val;
        } else {
          warnings.push(`header "${v}" has no colon — skipped`);
        }
      }
    } else if (
      tok === "-d" ||
      tok === "--data" ||
      tok === "--data-raw" ||
      tok === "--data-binary"
    ) {
      const v = takeValue(tok);
      if (v !== undefined) body = body === undefined ? v : `${body}&${v}`;
      // -d implies POST per curl's own default.
      if (!method) method = "POST";
    } else if (tok === "-u" || tok === "--user") {
      const v = takeValue(tok);
      if (v) {
        const idx = v.indexOf(":");
        if (idx >= 0) {
          basicAuth = { username: v.slice(0, idx), password: v.slice(idx + 1) };
        } else {
          basicAuth = { username: v, password: "" };
        }
      }
    } else if (tok === "--url") {
      const v = takeValue(tok);
      if (v) url = v;
    } else if (tok === "-G" || tok === "--get") {
      method = "GET";
    } else if (tok === "-I" || tok === "--head") {
      method = "HEAD";
    } else if (tok === "-L" || tok === "--location") {
      // Follow-redirects is the server's default behavior via fetch; no-op.
    } else if (tok === "-k" || tok === "--insecure") {
      warnings.push("-k/--insecure is not replayable from the GUI — ignored");
    } else if (tok === "-F" || tok === "--form") {
      warnings.push("--form multipart data isn't imported — skipped");
      takeValue(tok);
    } else if (tok === "--compressed" || tok === "-s" || tok === "--silent") {
      // Safe to ignore.
    } else if (tok.startsWith("-")) {
      warnings.push(`unknown flag "${tok}" — ignored`);
    } else if (!url) {
      url = tok;
    } else {
      warnings.push(`unexpected extra argument "${tok}"`);
    }
    i++;
  }

  if (!url) return { ok: false, error: "no URL found" };
  if (!method) method = "GET";

  const result: ParsedCurl = {
    method,
    url,
    headers,
    ...(body !== undefined ? { body } : {}),
    ...(basicAuth !== undefined ? { basicAuth } : {}),
    warnings,
  };
  return { ok: true, value: result };
}

/**
 * Shell-style tokenizer: splits on whitespace but respects single and double
 * quotes. Supports `\"` inside double quotes; single-quoted content is copied
 * verbatim (matching POSIX semantics curl commands rely on).
 */
function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    let tok = "";
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === " " || ch === "\t" || ch === "\n") break;
      if (ch === "'") {
        i++;
        while (i < src.length && src[i] !== "'") {
          tok += src[i];
          i++;
        }
        if (src[i] === "'") i++;
        continue;
      }
      if (ch === '"') {
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === "\\" && i + 1 < src.length) {
            tok += src[i + 1];
            i += 2;
            continue;
          }
          tok += src[i];
          i++;
        }
        if (src[i] === '"') i++;
        continue;
      }
      if (ch === "\\" && i + 1 < src.length) {
        tok += src[i + 1];
        i += 2;
        continue;
      }
      tok += ch;
      i++;
    }
    out.push(tok);
  }
  return out;
}
