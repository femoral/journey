import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import {
  IconClock,
  IconConsole,
  IconCopy,
  IconEditor,
  IconSearch,
  IconX,
  JsonPretty,
  MethodBadge,
  MiniTab,
  RunDot,
  StatusPill,
  type HttpMethod,
  type RunState,
} from "../ui";
import { toCurl, type ConsoleEntry } from "./consoleStore";
import { useConsole } from "./consoleContext";

export type ConsoleDockProps = {
  open: boolean;
  onClose: () => void;
};

const MIN_H = 200;
const MAX_H = 700;
const HEIGHT_KEY = "jrn:consoleHeight";

type Tab = "Network" | "Logs" | "Timing";
type MethodFilter = "all" | "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type StatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx";

export function ConsoleDock(props: ConsoleDockProps): JSX.Element {
  const store = useConsole();
  const [height, setHeight] = createSignal(
    Math.max(MIN_H, Math.min(MAX_H, Number(localStorage.getItem(HEIGHT_KEY)) || 300)),
  );
  const [tab, setTab] = createSignal<Tab>("Network");
  const [selectedId, setSelectedId] = createSignal<string | undefined>(undefined);
  const [methodFilter, setMethodFilter] = createSignal<MethodFilter>("all");
  const [statusFilter, setStatusFilter] = createSignal<StatusFilter>("all");
  const [query, setQuery] = createSignal("");

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height();
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_H, Math.min(MAX_H, startH + (startY - ev.clientY)));
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(HEIGHT_KEY, String(height()));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  onCleanup(() => {
    localStorage.setItem(HEIGHT_KEY, String(height()));
  });

  const visible = createMemo<ConsoleEntry[]>(() => {
    const q = query().toLowerCase();
    return store.entries().filter((e) => {
      if (methodFilter() !== "all" && e.method !== methodFilter()) return false;
      if (statusFilter() !== "all" && e.status !== undefined) {
        const klass = `${Math.floor(e.status / 100)}xx`;
        if (klass !== statusFilter()) return false;
      }
      if (q && !(e.url?.toLowerCase().includes(q) || e.stepName.toLowerCase().includes(q)))
        return false;
      return true;
    });
  });

  const selected = createMemo<ConsoleEntry | undefined>(() => {
    const id = selectedId();
    if (id) {
      const hit = store.entries().find((e) => e.id === id);
      if (hit) return hit;
    }
    // Auto-select the most recent entry when nothing is selected.
    return store.entries()[store.entries().length - 1];
  });

  return (
    <Show when={props.open}>
      <div
        style={{
          height: `${height()}px`,
          "flex-shrink": 0,
          "border-top": "1px solid var(--bd-2)",
          background: "var(--bg-0)",
          display: "flex",
          "flex-direction": "column",
          position: "relative",
        }}
        data-testid="console-dock"
      >
        <div
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="horizontal"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "-3px",
            height: "6px",
            cursor: "row-resize",
            "z-index": 2,
          }}
        />

        {/* header */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "0",
            padding: "0 12px",
            "border-bottom": "1px solid var(--bd-1)",
            height: "36px",
            "flex-shrink": 0,
          }}
        >
          <TabBtn
            active={tab() === "Network"}
            onClick={() => setTab("Network")}
            icon={<IconConsole size={12} />}
            label="Network"
            count={store.entries().length}
          />
          <TabBtn
            active={tab() === "Logs"}
            onClick={() => setTab("Logs")}
            icon={<IconEditor size={12} />}
            label="Logs"
            count={store.logs().length}
          />
          <TabBtn
            active={tab() === "Timing"}
            onClick={() => setTab("Timing")}
            icon={<IconClock size={12} />}
            label="Timing"
          />

          <div style={{ flex: 1 }} />

          <Show when={tab() === "Network"}>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "6px",
                "font-size": "11px",
              }}
            >
              <Chip
                label="method"
                value={methodFilter()}
                options={["all", "GET", "POST", "PUT", "PATCH", "DELETE"]}
                onChange={(v) => setMethodFilter(v as MethodFilter)}
              />
              <Chip
                label="status"
                value={statusFilter()}
                options={["all", "2xx", "3xx", "4xx", "5xx"]}
                onChange={(v) => setStatusFilter(v as StatusFilter)}
              />
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "5px",
                  padding: "3px 8px",
                  background: "var(--bg-2)",
                  border: "1px solid var(--bd-1)",
                  "border-radius": "4px",
                  width: "160px",
                }}
              >
                <IconSearch size={11} style={{ color: "var(--fg-3)" }} />
                <input
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  placeholder="filter"
                  class="mono"
                  style={{ flex: 1, "font-size": "11px" }}
                  data-testid="console-filter"
                />
              </div>
            </div>
          </Show>

          <div
            style={{
              width: "1px",
              height: "18px",
              background: "var(--bd-1)",
              margin: "0 6px",
            }}
          />
          <button
            onClick={() => store.clear()}
            title="Clear console"
            style={{ color: "var(--fg-2)", padding: "6px 8px", "font-size": "11px" }}
            data-testid="console-clear"
          >
            Clear
          </button>
          <button
            onClick={props.onClose}
            style={{ color: "var(--fg-2)", padding: "6px 8px" }}
            title="Close"
            data-testid="console-close"
          >
            <IconX size={12} />
          </button>
        </div>

        {/* content */}
        <Show when={tab() === "Network"}>
          <NetworkTab
            entries={visible()}
            selected={selected()}
            onSelect={setSelectedId}
          />
        </Show>
        <Show when={tab() === "Logs"}>
          <LogsTab logs={store.logs()} />
        </Show>
        <Show when={tab() === "Timing"}>
          <TimingTab entries={store.entries()} />
        </Show>
      </div>
    </Show>
  );
}

function TabBtn(props: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
  count?: number;
}): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      role="tab"
      aria-selected={props.active}
      style={{
        padding: "10px 12px",
        "font-size": "12px",
        display: "flex",
        "align-items": "center",
        gap: "6px",
        color: props.active ? "var(--fg-0)" : "var(--fg-2)",
        "border-bottom": props.active ? "2px solid var(--ac)" : "2px solid transparent",
        "margin-bottom": "-1px",
      }}
    >
      {props.icon}
      {props.label}
      <Show when={props.count !== undefined}>
        <span
          class="mono"
          style={{ "font-size": "10px", color: "var(--fg-3)" }}
        >
          {props.count}
        </span>
      </Show>
    </button>
  );
}

function Chip(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const active = () => props.value !== "all";
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        class="mono"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "4px",
          padding: "3px 8px",
          border: "1px solid var(--bd-1)",
          "border-radius": "3px",
          "font-size": "11px",
          background: active() ? "var(--ac-bg)" : "var(--bg-2)",
          color: active() ? "var(--ac)" : "var(--fg-2)",
        }}
      >
        <span>
          {props.label}:{props.value}
        </span>
      </button>
      <Show when={open()}>
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, "z-index": 60 }}
        />
        <div
          style={{
            position: "absolute",
            top: "100%",
            "margin-top": "3px",
            right: 0,
            "z-index": 70,
            background: "var(--bg-1)",
            border: "1px solid var(--bd-2)",
            "border-radius": "4px",
            padding: "3px",
            "min-width": "120px",
            "box-shadow": "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <For each={props.options}>
            {(opt) => (
              <button
                onClick={() => {
                  props.onChange(opt);
                  setOpen(false);
                }}
                class="mono"
                style={{
                  width: "100%",
                  padding: "4px 8px",
                  "text-align": "left",
                  "font-size": "11px",
                  "border-radius": "3px",
                  color: opt === props.value ? "var(--ac)" : "var(--fg-1)",
                  background: opt === props.value ? "var(--ac-bg)" : "transparent",
                }}
              >
                {opt}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function NetworkTab(props: {
  entries: ConsoleEntry[];
  selected: ConsoleEntry | undefined;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        "grid-template-columns": "minmax(0, 1fr) minmax(0, 1fr)",
        "min-height": 0,
      }}
    >
      <div
        style={{
          "border-right": "1px solid var(--bd-1)",
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            "grid-template-columns": "18px 42px 140px minmax(0, 1fr) 46px 56px",
            padding: "5px 12px",
            "font-size": "10px",
            color: "var(--fg-3)",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            "border-bottom": "1px solid var(--bd-1)",
            gap: "8px",
          }}
        >
          <span />
          <span>Method</span>
          <span>Step</span>
          <span>URL</span>
          <span style={{ "text-align": "right" }}>Status</span>
          <span style={{ "text-align": "right" }}>Time</span>
        </div>
        <div style={{ flex: 1, overflow: "auto" }} data-testid="console-rows">
          <Show
            when={props.entries.length > 0}
            fallback={
              <div
                style={{
                  padding: "24px 16px",
                  "font-size": "12px",
                  color: "var(--fg-3)",
                  "text-align": "center",
                }}
              >
                Run a journey or send a request to see traffic here.
              </div>
            }
          >
            <For each={props.entries}>
              {(e) => (
                <button
                  type="button"
                  data-testid={`console-row-${e.id}`}
                  onClick={() => props.onSelect(e.id)}
                  style={{
                    width: "100%",
                    display: "grid",
                    "grid-template-columns":
                      "18px 42px 140px minmax(0, 1fr) 46px 56px",
                    "align-items": "center",
                    gap: "8px",
                    padding: "5px 12px",
                    "text-align": "left",
                    background:
                      props.selected?.id === e.id
                        ? "var(--bg-3)"
                        : "transparent",
                    "border-bottom": "1px solid var(--bd-1)",
                  }}
                  onMouseEnter={(ev) => {
                    if (props.selected?.id !== e.id)
                      (ev.currentTarget as HTMLElement).style.background =
                        "var(--bg-1)";
                  }}
                  onMouseLeave={(ev) => {
                    if (props.selected?.id !== e.id)
                      (ev.currentTarget as HTMLElement).style.background =
                        "transparent";
                  }}
                >
                  <RunDot state={e.state as RunState} size={6} />
                  <Show
                    when={e.method}
                    fallback={<span style={{ color: "var(--fg-3)" }}>—</span>}
                  >
                    <MethodBadge method={e.method as HttpMethod} />
                  </Show>
                  <span
                    style={{
                      "font-size": "11px",
                      color: "var(--fg-2)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {e.stepName}
                  </span>
                  <span
                    class="mono"
                    style={{
                      "font-size": "11px",
                      color: "var(--fg-0)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {e.url ?? ""}
                  </span>
                  <span style={{ "text-align": "right" }}>
                    <Show
                      when={e.status !== undefined}
                      fallback={
                        <span
                          class="mono"
                          style={{ color: "var(--fg-3)", "font-size": "11px" }}
                        >
                          …
                        </span>
                      }
                    >
                      <StatusPill status={e.status!} />
                    </Show>
                  </span>
                  <span
                    class="mono"
                    style={{
                      "font-size": "11px",
                      color: "var(--fg-2)",
                      "text-align": "right",
                    }}
                  >
                    {e.durationMs !== undefined ? `${e.durationMs}ms` : ""}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* detail pane */}
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        <Show
          when={props.selected}
          fallback={
            <div
              style={{
                flex: 1,
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "var(--fg-3)",
                "font-size": "12px",
              }}
            >
              Select a row to inspect request / response.
            </div>
          }
        >
          {(entry) => <DetailPane entry={entry()} />}
        </Show>
      </div>
    </div>
  );
}

function DetailPane(props: { entry: ConsoleEntry }): JSX.Element {
  const [tab, setTab] = createSignal<"Request" | "Response" | "Headers">("Response");
  const [copied, setCopied] = createSignal(false);
  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(toCurl(props.entry));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore — clipboard denied */
    }
  };
  const bodyText = (body: unknown): string => {
    if (body === undefined) return "";
    if (typeof body === "string") return body;
    try {
      return JSON.stringify(body, null, 2);
    } catch {
      return String(body);
    }
  };
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "min-height": 0,
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--bd-1)",
          "flex-shrink": 0,
        }}
      >
        <Show when={props.entry.method}>
          <MethodBadge method={props.entry.method as HttpMethod} />
        </Show>
        <span
          class="mono"
          style={{
            "font-size": "11px",
            color: "var(--fg-1)",
            flex: 1,
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.entry.url ?? props.entry.stepName}
        </span>
        <Show when={props.entry.status !== undefined}>
          <StatusPill status={props.entry.status!} />
        </Show>
        <Show when={props.entry.durationMs !== undefined}>
          <span
            class="mono"
            style={{ "font-size": "11px", color: "var(--fg-2)" }}
          >
            {props.entry.durationMs}ms
          </span>
        </Show>
        <Show when={props.entry.size !== undefined}>
          <span
            class="mono"
            style={{ "font-size": "11px", color: "var(--fg-3)" }}
          >
            {formatBytes(props.entry.size!)}
          </span>
        </Show>
        <button
          onClick={() => void copyCurl()}
          title="Copy as cURL"
          data-testid="console-copy-curl"
          style={{
            display: "flex",
            "align-items": "center",
            gap: "4px",
            "font-size": "11px",
            color: copied() ? "var(--ok)" : "var(--fg-2)",
            padding: "3px 8px",
          }}
        >
          <IconCopy size={11} /> {copied() ? "copied" : "curl"}
        </button>
      </div>
      <div
        style={{
          display: "flex",
          "padding-left": "10px",
          "border-bottom": "1px solid var(--bd-1)",
          "flex-shrink": 0,
        }}
      >
        <MiniTab
          active={tab() === "Response"}
          onClick={() => setTab("Response")}
          label="Response"
        />
        <MiniTab
          active={tab() === "Request"}
          onClick={() => setTab("Request")}
          label="Request"
        />
        <MiniTab
          active={tab() === "Headers"}
          onClick={() => setTab("Headers")}
          label="Headers"
        />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <Show when={tab() === "Response"}>
          <Show
            when={props.entry.error}
            fallback={
              <pre
                class="mono"
                style={{
                  margin: 0,
                  padding: "10px 14px",
                  "font-size": "12px",
                  "line-height": 1.6,
                  color: "var(--fg-1)",
                  "white-space": "pre-wrap",
                }}
              >
                <JsonPretty text={bodyText(props.entry.responseBody)} />
              </pre>
            }
          >
            <div
              class="mono"
              style={{
                margin: 0,
                padding: "10px 14px",
                "font-size": "12px",
                color: "var(--err)",
                "white-space": "pre-wrap",
              }}
            >
              {props.entry.error}
            </div>
          </Show>
        </Show>
        <Show when={tab() === "Request"}>
          <pre
            class="mono"
            style={{
              margin: 0,
              padding: "10px 14px",
              "font-size": "12px",
              "line-height": 1.6,
              color: "var(--fg-1)",
              "white-space": "pre-wrap",
            }}
          >
            <JsonPretty text={bodyText(props.entry.requestBody)} />
          </pre>
        </Show>
        <Show when={tab() === "Headers"}>
          <HeadersView
            request={props.entry.requestHeaders}
            response={props.entry.responseHeaders}
          />
        </Show>
      </div>
    </div>
  );
}

function HeadersView(props: {
  request: Record<string, string> | undefined;
  response: Record<string, string> | undefined;
}): JSX.Element {
  return (
    <div style={{ padding: "10px 14px", "font-size": "11px" }}>
      <Show when={props.request}>
        <div
          style={{
            "font-size": "10px",
            color: "var(--fg-3)",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            "margin-bottom": "6px",
          }}
        >
          Request
        </div>
        <HeaderRows entries={Object.entries(props.request ?? {})} />
      </Show>
      <Show when={props.response}>
        <div
          style={{
            "font-size": "10px",
            color: "var(--fg-3)",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            margin: "14px 0 6px",
          }}
        >
          Response
        </div>
        <HeaderRows entries={Object.entries(props.response ?? {})} />
      </Show>
    </div>
  );
}

function HeaderRows(props: { entries: [string, string][] }): JSX.Element {
  return (
    <For each={props.entries}>
      {([k, v]) => (
        <div
          class="mono"
          style={{
            display: "grid",
            "grid-template-columns": "200px 1fr",
            gap: "12px",
            padding: "3px 0",
            "font-size": "11px",
          }}
        >
          <span style={{ color: "var(--info)" }}>{k}</span>
          <span style={{ color: "var(--fg-1)", "word-break": "break-all" }}>
            {v}
          </span>
        </div>
      )}
    </For>
  );
}

function LogsTab(props: { logs: Array<{ id: string; level: string; text: string; stepName: string; timestamp: number }> }): JSX.Element {
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <Show
        when={props.logs.length > 0}
        fallback={
          <div
            style={{
              padding: "24px 16px",
              "font-size": "12px",
              color: "var(--fg-3)",
              "text-align": "center",
            }}
          >
            No logs yet. Errors and hook `console.log` calls appear here.
          </div>
        }
      >
        <For each={props.logs}>
          {(log) => (
            <div
              class="mono"
              style={{
                padding: "5px 14px",
                "font-size": "11px",
                "border-bottom": "1px solid var(--bd-1)",
                display: "grid",
                "grid-template-columns": "60px 140px 1fr",
                gap: "10px",
              }}
            >
              <span
                style={{
                  color:
                    log.level === "error"
                      ? "var(--err)"
                      : log.level === "warn"
                        ? "var(--warn)"
                        : "var(--fg-3)",
                  "text-transform": "uppercase",
                  "font-size": "10px",
                }}
              >
                {log.level}
              </span>
              <span style={{ color: "var(--fg-3)" }}>{log.stepName}</span>
              <span
                style={{ color: "var(--fg-1)", "white-space": "pre-wrap" }}
              >
                {log.text}
              </span>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

function TimingTab(props: { entries: ConsoleEntry[] }): JSX.Element {
  const total = createMemo(() =>
    props.entries.reduce((a, e) => a + (e.durationMs ?? 0), 0),
  );
  const sorted = createMemo(() =>
    [...props.entries].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)),
  );
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
      <Show
        when={props.entries.length > 0}
        fallback={
          <div
            style={{
              padding: "12px",
              "font-size": "12px",
              color: "var(--fg-3)",
              "text-align": "center",
            }}
          >
            No timing data yet.
          </div>
        }
      >
        <div
          style={{
            "font-size": "10px",
            color: "var(--fg-3)",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            "margin-bottom": "8px",
          }}
        >
          Slowest steps · total {total()}ms
        </div>
        <For each={sorted()}>
          {(e) => (
            <div
              style={{
                display: "grid",
                "grid-template-columns": "42px minmax(0, 1fr) 60px",
                gap: "10px",
                "align-items": "center",
                padding: "4px 0",
                "font-size": "11px",
              }}
            >
              <Show when={e.method}>
                <MethodBadge method={e.method as HttpMethod} />
              </Show>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  "min-width": 0,
                }}
              >
                <span
                  class="mono"
                  style={{
                    "min-width": 0,
                    flex: "0 0 auto",
                    "max-width": "180px",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    color: "var(--fg-1)",
                  }}
                >
                  {e.stepName}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: "4px",
                    background: "var(--bg-2)",
                    "border-radius": "2px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${((e.durationMs ?? 0) / (total() || 1)) * 100}%`,
                      height: "100%",
                      background: "var(--ac)",
                    }}
                  />
                </div>
              </div>
              <span
                class="mono"
                style={{
                  "text-align": "right",
                  color: "var(--fg-2)",
                  "font-size": "11px",
                }}
              >
                {e.durationMs ?? 0}ms
              </span>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
