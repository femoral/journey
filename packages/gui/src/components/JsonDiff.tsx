import { createMemo, For, type Component } from "solid-js";

interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

function diffLines(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  const maxLen = Math.max(a.length, b.length);
  let ai = 0;
  let bi = 0;
  while (ai < a.length || bi < b.length) {
    if (ai < a.length && bi < b.length && a[ai] === b[bi]) {
      out.push({ kind: "same", text: a[ai]! });
      ai++;
      bi++;
    } else if (ai < a.length && (bi >= b.length || !b.includes(a[ai]!, bi))) {
      out.push({ kind: "del", text: a[ai]! });
      ai++;
    } else {
      out.push({ kind: "add", text: b[bi]! });
      bi++;
    }
  }
  return out;
}

export interface JsonDiffProps {
  left: unknown;
  right: unknown;
  leftLabel?: string;
  rightLabel?: string;
}

const COLORS: Record<DiffLine["kind"], string> = {
  same: "text-slate-400",
  add: "text-emerald-400 bg-emerald-900/20",
  del: "text-rose-400 bg-rose-900/20",
};

const PREFIX: Record<DiffLine["kind"], string> = {
  same: "  ",
  add: "+ ",
  del: "- ",
};

export const JsonDiff: Component<JsonDiffProps> = (props) => {
  const lines = createMemo(() => {
    const leftStr = JSON.stringify(props.left, null, 2) ?? "null";
    const rightStr = JSON.stringify(props.right, null, 2) ?? "null";
    return diffLines(leftStr.split("\n"), rightStr.split("\n"));
  });
  return (
    <div class="border border-slate-800 rounded p-3 overflow-auto max-h-96">
      <div class="flex gap-6 text-xs text-slate-500 mb-2">
        <span>{props.leftLabel ?? "previous"}</span>
        <span>{props.rightLabel ?? "current"}</span>
      </div>
      <pre class="text-xs font-mono" data-testid="diff-output">
        <For each={lines()}>
          {(line) => (
            <div class={COLORS[line.kind]}>
              {PREFIX[line.kind]}
              {line.text}
            </div>
          )}
        </For>
      </pre>
    </div>
  );
};
