import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import {
  Checkbox,
  FilterChip,
  IconPlus,
  JsonPretty,
  KVTable,
  MarkupHighlight,
  MethodBadge,
  MiniTab,
  Panel,
  QAButton,
  RunDot,
  SegBtn,
  Sparkline,
  Stat,
  StatusPill,
  TabButton,
  TimingBreakdown,
  TsHighlight,
  TypeHint,
} from "../src/ui";
import { createSignal } from "solid-js";

describe("MethodBadge", () => {
  it("renders full method for GET and abbreviates DELETE", () => {
    const { getByText: g1 } = render(() => <MethodBadge method="GET" />);
    expect(g1("GET")).toBeDefined();
    const { getByText: g2 } = render(() => <MethodBadge method="DELETE" />);
    expect(g2("DEL")).toBeDefined();
  });
});

describe("StatusPill", () => {
  it("colors status ranges distinctly", () => {
    render(() => (
      <>
        <StatusPill status={200} />
        <StatusPill status={404} />
        <StatusPill status={500} />
      </>
    ));
    const pills = screen.getAllByTestId("status-pill");
    expect(pills.length).toBe(3);
    expect(pills[0]?.textContent).toBe("200");
    expect(pills[1]?.textContent).toBe("404");
    expect(pills[2]?.textContent).toBe("500");
  });
});

describe("RunDot", () => {
  it("exposes state as a data attribute", () => {
    const { getByTestId } = render(() => <RunDot state="running" />);
    expect(getByTestId("run-dot").getAttribute("data-state")).toBe("running");
  });
});

describe("Panel", () => {
  it("renders title, badge, action, and children", () => {
    render(() => (
      <Panel title="Spec drift" badge="2" action={<span>View</span>}>
        <div>body</div>
      </Panel>
    ));
    expect(screen.getByText("Spec drift")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("View")).toBeDefined();
    expect(screen.getByText("body")).toBeDefined();
  });
});

describe("TabButton", () => {
  it("fires click and reflects active state", () => {
    const [active, setActive] = createSignal(false);
    render(() => (
      <TabButton active={active()} onClick={() => setActive(true)} label="Params" count={3} />
    ));
    const btn = screen.getByRole("tab");
    expect(btn.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(btn);
    expect(active()).toBe(true);
  });
});

describe("MiniTab", () => {
  it("shows count badge when provided", () => {
    render(() => <MiniTab active label="Hooks" count={2} />);
    expect(screen.getByText("2")).toBeDefined();
  });
});

describe("SegBtn", () => {
  it("calls onChange when a segment is clicked", () => {
    const [v, setV] = createSignal<"a" | "b">("a");
    render(() => <SegBtn options={["a", "b"]} value={v()} onChange={setV} />);
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[1]!);
    expect(v()).toBe("b");
  });
});

describe("Checkbox (Kobalte)", () => {
  it("toggles state via keyboard a11y surface", () => {
    const [checked, setChecked] = createSignal(false);
    render(() => <Checkbox checked={checked()} onChange={setChecked} aria-label="Enable" />);
    const cb = screen.getByRole("checkbox");
    fireEvent.click(cb);
    expect(checked()).toBe(true);
  });
});

describe("KVTable", () => {
  it("renders columns, rows, and optional add button", () => {
    const add = vi.fn();
    render(() => (
      <KVTable
        columns={{ template: "1fr 1fr", headers: ["Key", "Value"] }}
        rows={[
          { cells: [<span>a</span>, <span>1</span>] },
          { enabled: false, cells: [<span>b</span>, <span>2</span>] },
        ]}
        onAdd={add}
        addLabel="Add row"
      />
    ));
    expect(screen.getByText("Key")).toBeDefined();
    expect(screen.getByText("a")).toBeDefined();
    expect(screen.getByText("b")).toBeDefined();
    fireEvent.click(screen.getByText("Add row"));
    expect(add).toHaveBeenCalled();
  });
});

describe("JsonPretty", () => {
  it("renders all characters of the input JSON text", () => {
    const { container } = render(() => <JsonPretty text='{"id":"x","n":42,"ok":true}' />);
    expect(container.textContent).toBe('{"id":"x","n":42,"ok":true}');
  });
});

describe("TsHighlight", () => {
  it("preserves the entire input text", () => {
    const src = "import { journey } from '@usejourney/core'";
    const { container } = render(() => <TsHighlight text={src} />);
    expect(container.textContent).toBe(src);
  });
});

describe("MarkupHighlight", () => {
  it("preserves the entire input text", () => {
    const src = '<root attr="x"><child/></root>';
    const { container } = render(() => <MarkupHighlight text={src} />);
    expect(container.textContent).toBe(src);
  });
});

describe("TimingBreakdown", () => {
  it("shows the total value and one bar per segment", () => {
    const { container } = render(() => (
      <TimingBreakdown
        total={100}
        segments={[
          ["DNS", 10],
          ["TCP", 40],
          ["TTFB", 50],
        ]}
      />
    ));
    expect(container.textContent).toContain("100ms");
    const bars = container.querySelectorAll("div > div");
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Sparkline", () => {
  it("plots a line path for the provided values", () => {
    const { container } = render(() => <Sparkline values={[1, 3, 2, 5, 4]} />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
});

describe("TypeHint", () => {
  it("marks required with an indicator", () => {
    render(() => <TypeHint t="string" required />);
    expect(screen.getByText("string")).toBeDefined();
    expect(screen.getByText("required")).toBeDefined();
  });
});

describe("QAButton", () => {
  it("renders label and subtitle and fires onClick", () => {
    const click = vi.fn();
    render(() => <QAButton icon={IconPlus} label="New journey" sub="skeleton" onClick={click} />);
    fireEvent.click(screen.getByText("New journey"));
    expect(click).toHaveBeenCalled();
    expect(screen.getByText("skeleton")).toBeDefined();
  });
});

describe("Stat", () => {
  it("shows label, value, and sub", () => {
    render(() => <Stat label="Endpoints" value={42} sub="18 generated" />);
    expect(screen.getByText("Endpoints")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText("18 generated")).toBeDefined();
  });
});

describe("FilterChip", () => {
  it("renders the current value next to the label", () => {
    render(() => (
      <FilterChip
        label="method"
        options={["all", "GET", "POST"] as const}
        value="GET"
        onChange={() => {}}
      />
    ));
    expect(screen.getByText("method:GET")).toBeDefined();
  });
});
