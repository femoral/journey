export interface ParsedStep {
  name: string;
  endpoint?: string;
  start: number;
  end: number;
}

// Regex-based step extraction with character offsets into the source string.
// Balanced-brace counter finds each step's closing brace — robust against
// nested code inside the step's options block.
export function parseSteps(source: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  const re = /step\(\s*"([^"]+)"\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const stepStart = m.index;
    const name = m[1]!;
    let braces = 1;
    let i = stepStart + m[0].length;
    while (i < source.length && braces > 0) {
      if (source[i] === "{") braces++;
      else if (source[i] === "}") braces--;
      i++;
    }
    if (source[i] === ")") i++;
    if (source[i] === ";") i++;
    const stepEnd = i;
    const inner = source.slice(stepStart, stepEnd);
    const epMatch = inner.match(/endpoint:\s*([^,\n]+)/);
    const entry: ParsedStep = { name, start: stepStart, end: stepEnd };
    if (epMatch) entry.endpoint = epMatch[1]!.trim();
    steps.push(entry);
  }
  return steps;
}
