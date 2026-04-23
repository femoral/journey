import type { JSX } from "solid-js";

/**
 * Minimal XML / HTML colorizer — tints tag names, attribute names, and string
 * values. Not a parser; meant for display-only syntax tint over responses the
 * user is inspecting, not for round-tripping markup. Comments and CDATA are
 * recognised enough to avoid recolouring their contents.
 */
export type MarkupHighlightProps = {
  text: string;
};

export function MarkupHighlight(props: MarkupHighlightProps): JSX.Element {
  return <>{tokenize(props.text)}</>;
}

function tokenize(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let i = 0;
  const at = (k: number): string => text.charAt(k);
  while (i < text.length) {
    const c = at(i);
    if (c === "<" && text.startsWith("!--", i + 1)) {
      const end = text.indexOf("-->", i + 4);
      const stop = end === -1 ? text.length : end + 3;
      out.push(<span style={{ color: "var(--fg-3)" }}>{text.slice(i, stop)}</span>);
      i = stop;
    } else if (c === "<" && text.startsWith("![CDATA[", i + 1)) {
      const end = text.indexOf("]]>", i + 9);
      const stop = end === -1 ? text.length : end + 3;
      out.push(<span style={{ color: "var(--fg-2)" }}>{text.slice(i, stop)}</span>);
      i = stop;
    } else if (c === "<") {
      const end = text.indexOf(">", i + 1);
      const stop = end === -1 ? text.length : end + 1;
      out.push(...tag(text.slice(i, stop)));
      i = stop;
    } else {
      let j = i;
      while (j < text.length && at(j) !== "<") j++;
      out.push(<span>{text.slice(i, j)}</span>);
      i = j;
    }
  }
  return out;
}

function tag(segment: string): JSX.Element[] {
  // Segment always includes the surrounding `<` and `>` (or the final one
  // might be missing when the input ends mid-tag). Color the delimiters as
  // punctuation, the tag name as info, and attribute keys/values distinctly.
  const out: JSX.Element[] = [];
  out.push(<span style={{ color: "var(--fg-2)" }}>{"<"}</span>);
  let rest = segment.slice(1, segment.endsWith(">") ? -1 : undefined);
  if (rest.startsWith("/")) {
    out.push(<span style={{ color: "var(--fg-2)" }}>/</span>);
    rest = rest.slice(1);
  }
  const nameMatch = rest.match(/^([a-zA-Z_:][\w:\-.]*)/);
  if (nameMatch) {
    out.push(<span style={{ color: "var(--info)" }}>{nameMatch[1]}</span>);
    rest = rest.slice(nameMatch[1]!.length);
  }
  while (rest.length > 0) {
    const ws = rest.match(/^\s+/);
    if (ws) {
      out.push(<span>{ws[0]}</span>);
      rest = rest.slice(ws[0].length);
      continue;
    }
    const attr = rest.match(/^([a-zA-Z_:][\w:\-.]*)(?:=("([^"]*)"|'([^']*)'|(\S+)))?/);
    if (attr) {
      out.push(<span style={{ color: "var(--ac)" }}>{attr[1]}</span>);
      if (attr[2] !== undefined) {
        out.push(<span style={{ color: "var(--fg-2)" }}>=</span>);
        out.push(<span style={{ color: "var(--ok)" }}>{attr[2]}</span>);
      }
      rest = rest.slice(attr[0].length);
      continue;
    }
    if (rest.startsWith("/")) {
      out.push(<span style={{ color: "var(--fg-2)" }}>/</span>);
      rest = rest.slice(1);
      continue;
    }
    out.push(<span>{rest.charAt(0)}</span>);
    rest = rest.slice(1);
  }
  if (segment.endsWith(">")) {
    out.push(<span style={{ color: "var(--fg-2)" }}>{">"}</span>);
  }
  return out;
}
