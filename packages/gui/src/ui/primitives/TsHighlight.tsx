import type { JSX } from "solid-js";

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "default",
  "const",
  "let",
  "var",
  "async",
  "await",
  "return",
  "if",
  "else",
  "function",
  "new",
  "type",
  "interface",
]);

const JOURNEY_IDENTIFIERS = new Set([
  "journey",
  "step",
  "endpoints",
  "ctx",
  "res",
  "env",
  "expect",
]);

/**
 * Tiny, display-only TypeScript colorizer. Handles strings, line comments,
 * identifiers (keyword / Journey-DSL / PascalCase type / plain), and numbers.
 * Not a parser — don't expect correctness on edge cases; it's just for glow.
 */
export type TsHighlightProps = {
  text: string;
};

export function TsHighlight(props: TsHighlightProps): JSX.Element {
  return <>{tokenize(props.text)}</>;
}

function tokenize(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let i = 0;
  const at = (k: number): string => text.charAt(k);
  while (i < text.length) {
    const c = at(i);
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < text.length && at(j) !== q) {
        if (at(j) === "\\") j++;
        j++;
      }
      out.push(<span style={{ color: "var(--ok)" }}>{text.slice(i, j + 1)}</span>);
      i = j + 1;
    } else if (c === "/" && at(i + 1) === "/") {
      let j = i;
      while (j < text.length && at(j) !== "\n") j++;
      out.push(<span style={{ color: "var(--fg-3)" }}>{text.slice(i, j)}</span>);
      i = j;
    } else if (c === "/" && at(i + 1) === "*") {
      let j = i + 2;
      while (j < text.length - 1 && !(at(j) === "*" && at(j + 1) === "/")) j++;
      out.push(<span style={{ color: "var(--fg-3)" }}>{text.slice(i, j + 2)}</span>);
      i = j + 2;
    } else if (/[a-zA-Z_$]/.test(c)) {
      let j = i;
      while (j < text.length && /[a-zA-Z0-9_$]/.test(at(j))) j++;
      const w = text.slice(i, j);
      if (KEYWORDS.has(w)) {
        out.push(<span style={{ color: "var(--m-patch)" }}>{w}</span>);
      } else if (JOURNEY_IDENTIFIERS.has(w)) {
        out.push(<span style={{ color: "var(--ac)" }}>{w}</span>);
      } else if (w === "true" || w === "false" || w === "null" || w === "undefined") {
        out.push(<span style={{ color: "var(--m-patch)" }}>{w}</span>);
      } else if (/^[A-Z]/.test(w)) {
        out.push(<span style={{ color: "var(--info)" }}>{w}</span>);
      } else {
        out.push(<span style={{ color: "var(--fg-1)" }}>{w}</span>);
      }
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(at(j))) j++;
      out.push(<span style={{ color: "var(--ac)" }}>{text.slice(i, j)}</span>);
      i = j;
    } else {
      out.push(<span>{c}</span>);
      i++;
    }
  }
  return out;
}
