import type { JSX } from "solid-js";

/**
 * Minimal single-pass JSON colorizer. Not a full parser — meant for display-only
 * syntax tint of already-formatted JSON strings. Handles strings (differentiating
 * keys from values by look-ahead), numbers, booleans/null, and punctuation.
 */
export type JsonPrettyProps = {
  text: string;
};

export function JsonPretty(props: JsonPrettyProps): JSX.Element {
  return <>{tokenize(props.text)}</>;
}

function tokenize(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let i = 0;
  const at = (k: number): string => text.charAt(k);
  while (i < text.length) {
    const c = at(i);
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && at(j) !== '"') {
        if (at(j) === "\\") j++;
        j++;
      }
      const str = text.slice(i, j + 1);
      const rest = text.slice(j + 1);
      const isKey = /^\s*:/.test(rest);
      out.push(<span style={{ color: isKey ? "var(--info)" : "var(--ok)" }}>{str}</span>);
      i = j + 1;
    } else if (/[0-9-]/.test(c) && (i === 0 || !/[a-zA-Z_]/.test(at(i - 1)))) {
      let j = i;
      while (j < text.length && /[0-9.eE+\-]/.test(at(j))) j++;
      out.push(<span style={{ color: "var(--ac)" }}>{text.slice(i, j)}</span>);
      i = j;
    } else if (/[a-z]/.test(c)) {
      let j = i;
      while (j < text.length && /[a-z]/.test(at(j))) j++;
      const w = text.slice(i, j);
      if (w === "true" || w === "false" || w === "null") {
        out.push(<span style={{ color: "var(--m-patch)" }}>{w}</span>);
      } else {
        out.push(<span>{w}</span>);
      }
      i = j;
    } else {
      out.push(<span style={{ color: "var(--fg-2)" }}>{c}</span>);
      i++;
    }
  }
  return out;
}
