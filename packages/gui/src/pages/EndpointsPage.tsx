import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  type Component,
  type JSX,
} from "solid-js";
import {
  api,
  type EndpointSummary,
  type ParameterInfo,
  type ProxyResponse,
} from "../api/client";
import { useConsole } from "../shell/consoleContext";
import {
  Field,
  IconCopy,
  IconPlay,
  IconPlus,
  IconSearch,
  JsonPretty,
  MethodBadge,
  StatusPill,
  TabButton,
  type HttpMethod,
} from "../ui";

type ConfigTab = "params" | "headers" | "auth" | "body" | "scripts" | "docs";

type ParamRow = { name: string; enabled: boolean; value: string; info: ParameterInfo };

export const EndpointsPage: Component = () => {
  const cons = useConsole();
  const [list] = createResource(api.getEndpoints);
  const [selected, setSelected] = createSignal<EndpointSummary | undefined>(undefined);
  const [filter, setFilter] = createSignal("");
  const [tab, setTab] = createSignal<ConfigTab>("params");

  const [paramValues, setParamValues] = createSignal<Record<string, string>>({});
  const [queryValues, setQueryValues] = createSignal<Record<string, string>>({});
  const [headerRows, setHeaderRows] = createSignal<{ name: string; value: string; enabled: boolean }[]>([]);
  const [body, setBody] = createSignal("");

  const [response, setResponse] = createSignal<ProxyResponse | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);

  const groups = createMemo(() => {
    const endpoints = list()?.endpoints ?? [];
    const q = filter().toLowerCase();
    const visible = q
      ? endpoints.filter((e) => e.path.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      : endpoints;
    const byTag = new Map<string, EndpointSummary[]>();
    for (const e of visible) {
      const tag = tagFor(e.path);
      const arr = byTag.get(tag) ?? [];
      arr.push(e);
      byTag.set(tag, arr);
    }
    return [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  const pickEndpoint = (ep: EndpointSummary) => {
    setSelected(ep);
    setParamValues({});
    setQueryValues({});
    setHeaderRows([]);
    setBody("");
    setResponse(undefined);
    setError(undefined);
    setTab("params");
  };

  const send = async () => {
    const ep = selected();
    const l = list();
    if (!ep || !l) return;
    if (!l.baseUrl) {
      setError("No baseUrl configured in journey.config.json");
      return;
    }
    setBusy(true);
    setError(undefined);
    setResponse(undefined);
    try {
      const headerObj = Object.fromEntries(
        headerRows()
          .filter((r) => r.enabled && r.name.trim())
          .map((r) => [r.name.trim(), r.value]),
      );
      let bodyVal: unknown = undefined;
      if (body().trim()) {
        bodyVal = JSON.parse(body());
      }
      const base = l.baseUrl.endsWith("/") ? l.baseUrl : `${l.baseUrl}/`;
      const path = interpolate(ep.path, paramValues()).replace(/^\//, "");
      const query = Object.entries(queryValues())
        .filter(([, v]) => v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      const url = `${base}${path}${query ? `?${query}` : ""}`;
      // Synthesize a one-step run in the console so Endpoints "Send" traffic
      // lives in the same ledger as journey-run traffic.
      const runId = `oneoff-${Date.now()}`;
      cons.ingestSynthetic({
        runId,
        stepIdx: 0,
        stepName: ep.name,
        method: ep.method,
        url,
        requestHeaders: headerObj,
        ...(bodyVal !== undefined ? { requestBody: bodyVal } : {}),
        state: "running",
      });
      try {
        const res = await api.sendRequest({
          method: ep.method,
          url,
          headers: headerObj,
          ...(bodyVal !== undefined ? { body: bodyVal } : {}),
        });
        setResponse(res);
        cons.ingestSynthetic({
          runId,
          stepIdx: 0,
          stepName: ep.name,
          method: ep.method,
          url,
          requestHeaders: headerObj,
          ...(bodyVal !== undefined ? { requestBody: bodyVal } : {}),
          status: res.status,
          durationMs: res.durationMs,
          responseHeaders: res.headers,
          responseBody: res.body,
          state: res.status >= 200 && res.status < 400 ? "pass" : "fail",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cons.ingestSynthetic({
          runId,
          stepIdx: 0,
          stepName: ep.name,
          method: ep.method,
          url,
          requestHeaders: headerObj,
          state: "fail",
          error: msg,
        });
        throw e;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ display: "flex", height: "100%", "min-height": 0 }}
      data-testid="endpoints-page"
    >
      <aside
        style={{
          width: "280px",
          "border-right": "1px solid var(--bd-1)",
          display: "flex",
          "flex-direction": "column",
          background: "var(--bg-0)",
          "flex-shrink": 0,
        }}
      >
        <div
          style={{
            padding: "10px 10px 8px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              background: "var(--bg-2)",
              border: "1px solid var(--bd-1)",
              "border-radius": "4px",
              padding: "5px 8px",
            }}
          >
            <IconSearch size={12} style={{ color: "var(--fg-3)" }} />
            <input
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              placeholder="filter…"
              class="mono"
              style={{ flex: 1, "font-size": "12px" }}
              data-testid="endpoint-filter"
            />
          </div>
        </div>
        <div
          style={{ flex: 1, overflow: "auto", padding: "4px 0" }}
          data-testid="endpoint-list"
        >
          <Show when={list()}>
            <For each={groups()}>
              {([tagName, items]) => (
                <div>
                  <div
                    style={{
                      padding: "8px 14px 4px",
                      "font-size": "10px",
                      color: "var(--fg-3)",
                      "text-transform": "uppercase",
                      "letter-spacing": "0.08em",
                    }}
                  >
                    {tagName}
                  </div>
                  <For each={items}>
                    {(ep) => (
                      <button
                        type="button"
                        data-testid={`endpoint-row-${ep.name}`}
                        onClick={() => pickEndpoint(ep)}
                        style={{
                          width: "100%",
                          display: "flex",
                          "align-items": "center",
                          gap: "8px",
                          padding: "4px 14px",
                          background:
                            selected()?.name === ep.name ? "var(--bg-3)" : "transparent",
                          "border-left":
                            selected()?.name === ep.name
                              ? "2px solid var(--ac)"
                              : "2px solid transparent",
                          "text-align": "left",
                          "font-size": "12px",
                          color: "var(--fg-1)",
                        }}
                        onMouseEnter={(e) => {
                          if (selected()?.name !== ep.name)
                            (e.currentTarget as HTMLElement).style.background =
                              "var(--bg-1)";
                        }}
                        onMouseLeave={(e) => {
                          if (selected()?.name !== ep.name)
                            (e.currentTarget as HTMLElement).style.background =
                              "transparent";
                        }}
                      >
                        <MethodBadge method={ep.method as HttpMethod} />
                        <span
                          class="mono"
                          style={{
                            flex: 1,
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {ep.path}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
      </aside>

      <section
        style={{
          flex: 1,
          "min-width": 0,
          display: "flex",
          "flex-direction": "column",
        }}
      >
        <Show
          when={selected()}
          fallback={
            <div
              style={{
                flex: 1,
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "var(--fg-3)",
                "font-size": "13px",
              }}
            >
              Select an endpoint on the left.
            </div>
          }
        >
          {(ep) => (
            <>
              <AddressBar
                endpoint={ep()}
                baseUrl={list()?.baseUrl}
                busy={busy()}
                onSend={send}
              />

              <div
                style={{
                  display: "flex",
                  "border-bottom": "1px solid var(--bd-1)",
                  "padding-left": "12px",
                  "flex-shrink": 0,
                }}
                role="tablist"
              >
                {(
                  [
                    ["params", "Params"],
                    ["headers", "Headers"],
                    ["auth", "Auth"],
                    ["body", "Body"],
                    ["scripts", "Scripts"],
                    ["docs", "Docs"],
                  ] as const
                ).map(([id, label]) => (
                  <TabButton
                    active={tab() === id}
                    onClick={() => setTab(id)}
                    label={label}
                  />
                ))}
              </div>

              <div
                style={{
                  flex: 1,
                  "min-height": 0,
                  display: "grid",
                  "grid-template-rows": "1fr 1fr",
                }}
              >
                <div
                  style={{
                    overflow: "auto",
                    "border-bottom": "1px solid var(--bd-1)",
                  }}
                >
                  <Show when={tab() === "params"}>
                    <TabParams
                      endpoint={ep()}
                      paramValues={paramValues()}
                      queryValues={queryValues()}
                      onParamInput={(name, v) =>
                        setParamValues({ ...paramValues(), [name]: v })
                      }
                      onQueryInput={(name, v) =>
                        setQueryValues({ ...queryValues(), [name]: v })
                      }
                    />
                  </Show>
                  <Show when={tab() === "headers"}>
                    <TabHeaders
                      rows={headerRows()}
                      onChange={setHeaderRows}
                    />
                  </Show>
                  <Show when={tab() === "auth"}>
                    <Placeholder label="Auth presets (Basic / Bearer / API key / OAuth2) ship in M6." />
                  </Show>
                  <Show when={tab() === "body"}>
                    <TabBody value={body()} onInput={setBody} />
                  </Show>
                  <Show when={tab() === "scripts"}>
                    <Placeholder label="Pre- and post-request scripts ship in M6." />
                  </Show>
                  <Show when={tab() === "docs"}>
                    <TabDocs endpoint={ep()} />
                  </Show>
                </div>
                <ResponsePane busy={busy()} response={response()} error={error()} />
              </div>
            </>
          )}
        </Show>
      </section>
    </div>
  );
};

function AddressBar(props: {
  endpoint: EndpointSummary;
  baseUrl: string | undefined;
  busy: boolean;
  onSend: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        padding: "10px 16px",
        "border-bottom": "1px solid var(--bd-1)",
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "flex-shrink": 0,
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          border: "1px solid var(--bd-2)",
          "border-radius": "5px",
          padding: "0 10px",
          background: "var(--bg-1)",
          flex: 1,
          "min-width": 0,
        }}
      >
        <MethodBadge method={props.endpoint.method as HttpMethod} size="lg" />
        <div style={{ width: "1px", height: "20px", background: "var(--bd-2)" }} />
        <span
          class="mono"
          style={{
            color: "var(--fg-3)",
            "font-size": "12px",
            padding: "8px 0",
          }}
        >
          {props.baseUrl ?? "{{baseUrl}}"}
        </span>
        <span
          class="mono"
          style={{
            color: "var(--fg-0)",
            "font-size": "13px",
            padding: "8px 0",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.endpoint.path}
        </span>
        <div style={{ flex: 1 }} />
        <Show when={props.endpoint.operationId}>
          <span
            class="mono"
            style={{ "font-size": "11px", color: "var(--fg-3)" }}
          >
            {props.endpoint.operationId}
          </span>
        </Show>
      </div>
      <button
        type="button"
        data-testid="send-button"
        disabled={props.busy}
        onClick={props.onSend}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "7px 14px",
          background: "var(--ac)",
          color: "#1a1200",
          "border-radius": "5px",
          "font-weight": 600,
          "font-size": "12px",
          opacity: props.busy ? 0.6 : 1,
          cursor: props.busy ? "wait" : "pointer",
        }}
      >
        <IconPlay size={11} /> {props.busy ? "Sending…" : "Send"}
      </button>
      <button
        type="button"
        title="Save as journey step (M6)"
        disabled
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "7px 12px",
          border: "1px solid var(--bd-2)",
          "border-radius": "5px",
          "font-size": "12px",
          color: "var(--fg-2)",
          opacity: 0.5,
          cursor: "not-allowed",
        }}
      >
        <IconPlus size={11} /> Save as step
      </button>
      <button
        type="button"
        title="Copy as cURL (M5)"
        disabled
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "7px 10px",
          border: "1px solid var(--bd-2)",
          "border-radius": "5px",
          "font-size": "12px",
          color: "var(--fg-2)",
          opacity: 0.5,
          cursor: "not-allowed",
        }}
      >
        <IconCopy size={11} /> curl
      </button>
    </div>
  );
}

function TabParams(props: {
  endpoint: EndpointSummary;
  paramValues: Record<string, string>;
  queryValues: Record<string, string>;
  onParamInput: (name: string, v: string) => void;
  onQueryInput: (name: string, v: string) => void;
}): JSX.Element {
  const rows = createMemo<ParamRow[]>(() => {
    const out: ParamRow[] = [];
    for (const info of paramsByLocation(props.endpoint, "path")) {
      out.push({
        name: info.name,
        enabled: true,
        value: props.paramValues[info.name] ?? "",
        info,
      });
    }
    for (const info of paramsByLocation(props.endpoint, "query")) {
      out.push({
        name: info.name,
        enabled: true,
        value: props.queryValues[info.name] ?? "",
        info,
      });
    }
    return out;
  });

  return (
    <div>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "60px 160px 100px 1fr",
          padding: "6px 16px",
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          "border-bottom": "1px solid var(--bd-1)",
          gap: "8px",
        }}
      >
        <div>In</div>
        <div>Key</div>
        <div>Type</div>
        <div>Value</div>
      </div>
      <Show
        when={rows().length > 0}
        fallback={
          <div
            style={{
              padding: "18px 16px",
              "font-size": "12px",
              color: "var(--fg-3)",
            }}
          >
            This endpoint takes no path or query parameters.
          </div>
        }
      >
        <For each={rows()}>
          {(r) => (
            <div
              style={{
                display: "grid",
                "grid-template-columns": "60px 160px 100px 1fr",
                padding: "6px 16px",
                "align-items": "center",
                gap: "8px",
                "border-bottom": "1px solid var(--bd-1)",
              }}
            >
              <span
                class="mono"
                style={{
                  "font-size": "11px",
                  color: r.info.in === "path" ? "var(--info)" : "var(--fg-2)",
                  "text-transform": "uppercase",
                }}
              >
                {r.info.in}
              </span>
              <div
                style={{ display: "flex", "align-items": "center", gap: "6px" }}
              >
                <span
                  class="mono"
                  style={{
                    "font-size": "12px",
                    color: "var(--fg-0)",
                    "font-weight": 500,
                  }}
                >
                  {r.info.name}
                </span>
                <Show when={r.info.required}>
                  <span
                    title="Required"
                    style={{
                      width: "4px",
                      height: "4px",
                      "border-radius": "50%",
                      background: "var(--ac)",
                    }}
                  />
                </Show>
              </div>
              <span
                class="mono"
                style={{ "font-size": "10px", color: "var(--fg-3)" }}
              >
                string
              </span>
              <input
                value={r.value}
                placeholder={r.info.description ?? "value"}
                class="mono"
                data-testid={`${r.info.in === "path" ? "param" : "query"}-${r.info.name}`}
                onInput={(e) =>
                  r.info.in === "path"
                    ? props.onParamInput(r.info.name, e.currentTarget.value)
                    : props.onQueryInput(r.info.name, e.currentTarget.value)
                }
                style={{
                  width: "100%",
                  "font-size": "12px",
                  color: "var(--fg-0)",
                  padding: "3px 0",
                }}
              />
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

function TabHeaders(props: {
  rows: { name: string; value: string; enabled: boolean }[];
  onChange: (rows: { name: string; value: string; enabled: boolean }[]) => void;
}): JSX.Element {
  const addRow = () =>
    props.onChange([...props.rows, { name: "", value: "", enabled: true }]);

  const update = (
    i: number,
    patch: Partial<{ name: string; value: string; enabled: boolean }>,
  ) => {
    props.onChange(
      props.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  };
  const remove = (i: number) =>
    props.onChange(props.rows.filter((_, idx) => idx !== i));

  return (
    <div>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "220px 1fr 24px",
          padding: "6px 16px",
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          "border-bottom": "1px solid var(--bd-1)",
          gap: "8px",
        }}
      >
        <div>Header</div>
        <div>Value</div>
        <div />
      </div>
      <For each={props.rows}>
        {(r, i) => (
          <div
            style={{
              display: "grid",
              "grid-template-columns": "220px 1fr 24px",
              padding: "6px 16px",
              "align-items": "center",
              gap: "8px",
              "border-bottom": "1px solid var(--bd-1)",
            }}
          >
            <input
              value={r.name}
              placeholder="Authorization"
              class="mono"
              style={{ "font-size": "12px", width: "100%" }}
              onInput={(e) => update(i(), { name: e.currentTarget.value })}
              data-testid={`headers-input`}
            />
            <input
              value={r.value}
              placeholder="Bearer {{env.TOKEN}}"
              class="mono"
              style={{ "font-size": "12px", width: "100%" }}
              onInput={(e) => update(i(), { value: e.currentTarget.value })}
            />
            <button
              type="button"
              onClick={() => remove(i())}
              style={{ color: "var(--fg-3)" }}
              aria-label="Remove header"
            >
              ×
            </button>
          </div>
        )}
      </For>
      <button
        type="button"
        onClick={addRow}
        style={{
          padding: "8px 16px",
          color: "var(--fg-3)",
          "font-size": "12px",
          display: "flex",
          "align-items": "center",
          gap: "6px",
        }}
      >
        <IconPlus size={11} /> Add header
      </button>
    </div>
  );
}

function TabBody(props: {
  value: string;
  onInput: (v: string) => void;
}): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div
        style={{
          padding: "8px 16px",
          "border-bottom": "1px solid var(--bd-1)",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
        <span
          class="mono"
          style={{
            "font-size": "11px",
            color: "var(--fg-2)",
            padding: "3px 10px",
            background: "var(--bg-2)",
            "border-radius": "3px",
          }}
        >
          JSON
        </span>
        <span
          class="mono"
          style={{ "font-size": "10px", color: "var(--fg-3)" }}
        >
          Form / Urlencoded / Raw / Binary — M6
        </span>
      </div>
      <textarea
        data-testid="body-input"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        class="mono"
        placeholder='{"amount": 12900}'
        style={{
          flex: 1,
          margin: 0,
          padding: "14px 16px",
          "font-size": "12px",
          "line-height": 1.7,
          color: "var(--fg-1)",
          background: "var(--bg-0)",
          resize: "none",
          width: "100%",
        }}
      />
    </div>
  );
}

function TabDocs(props: { endpoint: EndpointSummary }): JSX.Element {
  return (
    <div
      style={{ padding: "18px 20px", "max-width": "680px", "font-size": "12px" }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-bottom": "6px",
        }}
      >
        <MethodBadge method={props.endpoint.method as HttpMethod} size="lg" />
        <span class="mono" style={{ "font-size": "14px" }}>
          {props.endpoint.path}
        </span>
      </div>
      <Show when={props.endpoint.operationId}>
        <h2 style={{ "font-size": "16px", "font-weight": 600, margin: "10px 0 8px" }}>
          {props.endpoint.operationId}
        </h2>
      </Show>
      <Show
        when={props.endpoint.parameters.length > 0}
        fallback={
          <p style={{ color: "var(--fg-2)", margin: 0 }}>
            No declared parameters.
          </p>
        }
      >
        <p style={{ color: "var(--fg-2)", margin: "0 0 10px" }}>Parameters:</p>
        <ul
          style={{
            margin: 0,
            padding: 0,
            "list-style": "none",
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
          }}
        >
          <For each={props.endpoint.parameters}>
            {(p) => (
              <li
                class="mono"
                style={{
                  "font-size": "11px",
                  color: "var(--fg-1)",
                }}
              >
                <span
                  style={{ color: "var(--info)", "text-transform": "uppercase" }}
                >
                  {p.in}
                </span>
                {" · "}
                <span style={{ color: "var(--fg-0)" }}>{p.name}</span>
                <Show when={p.required}>
                  <span style={{ color: "var(--ac)" }}> (required)</span>
                </Show>
                <Show when={p.description}>
                  <span style={{ color: "var(--fg-3)" }}> — {p.description}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function ResponsePane(props: {
  busy: boolean;
  response: ProxyResponse | undefined;
  error: string | undefined;
}): JSX.Element {
  const bodyText = () => {
    const r = props.response;
    if (!r) return "";
    try {
      return JSON.stringify(r.body, null, 2);
    } catch {
      return String(r.body);
    }
  };
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "min-height": 0,
        background: "var(--bg-0)",
      }}
      data-testid="response-panel"
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
          padding: "8px 16px",
          "border-bottom": "1px solid var(--bd-1)",
          "flex-shrink": 0,
        }}
      >
        <Show
          when={props.response}
          fallback={
            <span style={{ "font-size": "11px", color: "var(--fg-3)" }}>
              {props.busy ? "Sending…" : "No response yet."}
            </span>
          }
        >
          {(r) => (
            <>
              <span data-testid="response-status" style={{ display: "contents" }}>
                <StatusPill status={r().status} />
              </span>
              <span
                class="mono"
                style={{ "font-size": "11px", color: "var(--fg-2)" }}
              >
                {r().durationMs}ms
              </span>
            </>
          )}
        </Show>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <Show when={props.error}>
          <p
            data-testid="request-error"
            style={{
              padding: "14px 16px",
              margin: 0,
              color: "var(--err)",
              "font-size": "12px",
            }}
          >
            {props.error}
          </p>
        </Show>
        <Show when={props.response}>
          <pre
            data-testid="response-body"
            class="mono"
            style={{
              margin: 0,
              padding: "14px 16px",
              "font-size": "12px",
              "line-height": 1.7,
              color: "var(--fg-1)",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}
          >
            <JsonPretty text={bodyText()} />
          </pre>
        </Show>
      </div>
    </div>
  );
}

function Placeholder(props: { label: string }): JSX.Element {
  return (
    <div
      style={{
        padding: "20px 16px",
        "font-size": "12px",
        color: "var(--fg-3)",
        display: "flex",
        "align-items": "center",
        gap: "8px",
      }}
    >
      {props.label}
    </div>
  );
}

function interpolate(path: string, params: Record<string, string>): string {
  let out = path;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(`{${k}}`, encodeURIComponent(v));
  }
  return out;
}

function paramsByLocation(
  endpoint: EndpointSummary,
  loc: ParameterInfo["in"],
): ParameterInfo[] {
  if (loc === "path") {
    const declared = endpoint.parameters.filter((p) => p.in === "path");
    const declaredNames = new Set(declared.map((p) => p.name));
    const fromPath = [...endpoint.path.matchAll(/\{([^}]+)\}/g)]
      .map((m) => m[1]!)
      .filter((n) => !declaredNames.has(n))
      .map((n): ParameterInfo => ({ name: n, in: "path", required: true }));
    return [...declared, ...fromPath];
  }
  return endpoint.parameters.filter((p) => p.in === loc);
}

function tagFor(path: string): string {
  const stripped = path.replace(/^\//, "");
  const first = stripped.split("/")[0] ?? "";
  // Collapse /v1/, /v2/, /api/ etc. to the segment after it
  if (/^v\d+$|^api$/i.test(first)) {
    const second = stripped.split("/")[1];
    if (second && !second.startsWith("{")) return titleCase(second);
  }
  if (!first || first.startsWith("{")) return "—";
  return titleCase(first);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
