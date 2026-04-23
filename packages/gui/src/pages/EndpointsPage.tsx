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
import {
  contribute as authContribute,
  defaultPreset,
  fetchOAuth2Token,
  type AuthPreset,
  type AuthPresetKind,
} from "./auth";
import { SaveAsStepDialog, type SaveAsStepPayload } from "./SaveAsStepDialog";
import { useSearchParams } from "@solidjs/router";
import { createEffect } from "solid-js";
import { useConsole } from "../shell/consoleContext";
import {
  Checkbox,
  Field,
  IconCopy,
  IconPlay,
  IconPlus,
  IconSearch,
  JsonPretty,
  MarkupHighlight,
  MethodBadge,
  MiniTab,
  StatusPill,
  TabButton,
  TypeHint,
  type HttpMethod,
} from "../ui";

type ConfigTab = "params" | "headers" | "auth" | "body" | "scripts" | "docs";

type ParamRow = { name: string; enabled: boolean; value: string; info: ParameterInfo };

export const EndpointsPage: Component = () => {
  const cons = useConsole();
  const [params] = useSearchParams<{ method?: string; url?: string }>();
  const [list] = createResource(api.getEndpoints);
  const [selected, setSelected] = createSignal<EndpointSummary | undefined>(undefined);
  const [filter, setFilter] = createSignal("");
  const [tab, setTab] = createSignal<ConfigTab>("params");

  const [paramValues, setParamValues] = createSignal<Record<string, string>>({});
  const [queryValues, setQueryValues] = createSignal<Record<string, string>>({});
  const [paramDisabled, setParamDisabled] = createSignal<Record<string, boolean>>({});
  const [headerRows, setHeaderRows] = createSignal<{ name: string; value: string; enabled: boolean }[]>([]);
  const [body, setBody] = createSignal<BodyState>({ kind: "none" });

  const [response, setResponse] = createSignal<ProxyResponse | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);
  const [auth, setAuth] = createSignal<AuthPreset>({ kind: "none" });
  const [saveAsStepOpen, setSaveAsStepOpen] = createSignal(false);

  // Active env values feed `{{env.VAR}}` interpolation in auth presets.
  const [envs] = createResource(() => api.getEnvironments());
  const activeEnv = createMemo<Record<string, string>>(() => {
    const data = envs();
    if (!data) return {};
    const name = data.defaultEnvironment;
    const match = data.environments.find((e) => e.name === name);
    return match?.values ?? {};
  });

  // "Send via Endpoints" from the Journeys step card deep-links with method +
  // url params; match an endpoint whose (method, base+path) matches and select
  // it. Falls back silently if no match is found (the user can still pick one).
  let appliedDeepLink = false;
  createEffect(() => {
    if (appliedDeepLink) return;
    const m = params.method;
    const u = params.url;
    const l = list();
    if (!m || !u || !l) return;
    appliedDeepLink = true;
    const base = l.baseUrl?.replace(/\/$/, "") ?? "";
    const ep = l.endpoints.find(
      (e) => e.method.toUpperCase() === m.toUpperCase() && matchesUrl(u, base, e.path),
    );
    if (ep) pickEndpoint(ep);
  });

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
    setParamDisabled({});
    setHeaderRows([]);
    setBody({ kind: "none" });
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
      const authPart = authContribute(auth(), activeEnv());
      const headerObj = {
        ...authPart.headers,
        ...Object.fromEntries(
          headerRows()
            .filter((r) => r.enabled && r.name.trim())
            .map((r) => [r.name.trim(), r.value]),
        ),
      };
      const dispatched = serializeBody(body());
      if (dispatched.contentType) {
        // Don't clobber a user-set Content-Type header.
        const hasCt = Object.keys(headerObj).some(
          (k) => k.toLowerCase() === "content-type",
        );
        if (!hasCt) headerObj["Content-Type"] = dispatched.contentType;
      }
      const bodyVal = dispatched.payload;
      const base = l.baseUrl.endsWith("/") ? l.baseUrl : `${l.baseUrl}/`;
      // Disabled path params stay templated — let the server surface the
      // missing-param error rather than silently dropping them.
      const activePathParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(paramValues())) {
        if (!paramDisabled()[`path:${k}`]) activePathParams[k] = v;
      }
      const path = interpolate(ep.path, activePathParams).replace(/^\//, "");
      const activeQueryValues: Record<string, string> = {};
      for (const [k, v] of Object.entries(queryValues())) {
        if (!paramDisabled()[`query:${k}`]) activeQueryValues[k] = v;
      }
      const mergedQuery = { ...authPart.query, ...activeQueryValues };
      const query = Object.entries(mergedQuery)
        .filter(([, v]) => v !== "" && v !== undefined)
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
                onSaveAsStep={() => setSaveAsStepOpen(true)}
              />
              <SaveAsStepDialog
                open={saveAsStepOpen()}
                onClose={() => setSaveAsStepOpen(false)}
                payload={buildSaveAsStepPayload(
                  ep(),
                  paramValues(),
                  paramDisabled(),
                  headerRows(),
                  body(),
                )}
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
                      disabled={paramDisabled()}
                      onParamInput={(name, v) =>
                        setParamValues({ ...paramValues(), [name]: v })
                      }
                      onQueryInput={(name, v) =>
                        setQueryValues({ ...queryValues(), [name]: v })
                      }
                      onToggle={(key, enabled) =>
                        setParamDisabled({
                          ...paramDisabled(),
                          [key]: !enabled,
                        })
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
                    <TabAuth
                      value={auth()}
                      onChange={setAuth}
                      env={activeEnv()}
                    />
                  </Show>
                  <Show when={tab() === "body"}>
                    <TabBody value={body()} onChange={setBody} />
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
  onSaveAsStep: () => void;
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
        onClick={props.onSaveAsStep}
        data-testid="save-as-step"
        title="Append this request as a step in a journey file"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "7px 12px",
          border: "1px solid var(--bd-2)",
          "border-radius": "5px",
          "font-size": "12px",
          color: "var(--fg-1)",
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

const PARAM_GRID = "14px 50px 160px 100px 1fr";

function TabParams(props: {
  endpoint: EndpointSummary;
  paramValues: Record<string, string>;
  queryValues: Record<string, string>;
  disabled: Record<string, boolean>;
  onParamInput: (name: string, v: string) => void;
  onQueryInput: (name: string, v: string) => void;
  onToggle: (key: string, enabled: boolean) => void;
}): JSX.Element {
  const rows = createMemo<ParamRow[]>(() => {
    const out: ParamRow[] = [];
    for (const info of paramsByLocation(props.endpoint, "path")) {
      out.push({
        name: info.name,
        enabled: !props.disabled[`path:${info.name}`],
        value: props.paramValues[info.name] ?? "",
        info,
      });
    }
    for (const info of paramsByLocation(props.endpoint, "query")) {
      out.push({
        name: info.name,
        enabled: !props.disabled[`query:${info.name}`],
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
          "grid-template-columns": PARAM_GRID,
          padding: "6px 16px",
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          "border-bottom": "1px solid var(--bd-1)",
          gap: "8px",
        }}
      >
        <div />
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
          {(r) => {
            const key = `${r.info.in}:${r.info.name}`;
            return (
              <div
                style={{
                  display: "grid",
                  "grid-template-columns": PARAM_GRID,
                  padding: "6px 16px",
                  "align-items": "center",
                  gap: "8px",
                  "border-bottom": "1px solid var(--bd-1)",
                  opacity: r.enabled ? 1 : 0.5,
                }}
                data-testid={`param-row-${r.info.in}-${r.info.name}`}
              >
                <Checkbox
                  checked={r.enabled}
                  onChange={(v) => props.onToggle(key, v)}
                  aria-label={`Include ${r.info.name}`}
                />
                <span
                  class="mono"
                  style={{
                    "font-size": "11px",
                    color:
                      r.info.in === "path" ? "var(--info)" : "var(--fg-2)",
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
                <TypeHint t="string" required={r.info.required} />
                <input
                  value={r.value}
                  placeholder={r.info.description ?? "value"}
                  class="mono"
                  data-testid={`${r.info.in === "path" ? "param" : "query"}-${r.info.name}`}
                  disabled={!r.enabled}
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
            );
          }}
        </For>
      </Show>
    </div>
  );
}

const HEADER_GRID = "14px 220px 1fr 24px";

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
          "grid-template-columns": HEADER_GRID,
          padding: "6px 16px",
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          "border-bottom": "1px solid var(--bd-1)",
          gap: "8px",
        }}
      >
        <div />
        <div>Header</div>
        <div>Value</div>
        <div />
      </div>
      <For each={props.rows}>
        {(r, i) => (
          <div
            style={{
              display: "grid",
              "grid-template-columns": HEADER_GRID,
              padding: "6px 16px",
              "align-items": "center",
              gap: "8px",
              "border-bottom": "1px solid var(--bd-1)",
              opacity: r.enabled ? 1 : 0.5,
            }}
          >
            <Checkbox
              checked={r.enabled}
              onChange={(v) => update(i(), { enabled: v })}
              aria-label={`Include header ${r.name || "(unnamed)"}`}
            />
            <input
              value={r.name}
              placeholder="Authorization"
              class="mono"
              disabled={!r.enabled}
              style={{ "font-size": "12px", width: "100%" }}
              onInput={(e) => update(i(), { name: e.currentTarget.value })}
              data-testid={`headers-input`}
            />
            <input
              value={r.value}
              placeholder="Bearer {{env.TOKEN}}"
              class="mono"
              disabled={!r.enabled}
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

type BodyKind = BodyState["kind"];

type BodyState =
  | { kind: "none" }
  | { kind: "json"; text: string }
  | {
      kind: "urlencoded";
      rows: Array<{ name: string; value: string; enabled: boolean }>;
    }
  | { kind: "raw"; text: string; contentType: string };

/**
 * Build the outgoing payload + matching Content-Type from a BodyState. The
 * proxy passes strings through untouched and JSON-stringifies objects — so we
 * hand back an object for JSON mode and a string for urlencoded / raw.
 */
function serializeBody(body: BodyState): {
  payload: unknown;
  contentType: string | undefined;
} {
  if (body.kind === "none") return { payload: undefined, contentType: undefined };
  if (body.kind === "json") {
    if (!body.text.trim()) return { payload: undefined, contentType: undefined };
    try {
      return { payload: JSON.parse(body.text), contentType: "application/json" };
    } catch (e) {
      // Surface the parse error the same way it always has — bubble up from
      // send() where we already have try/catch with setError.
      throw new Error(
        `Body isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (body.kind === "urlencoded") {
    const params = new URLSearchParams();
    for (const r of body.rows) {
      if (r.enabled && r.name.trim()) params.append(r.name.trim(), r.value);
    }
    const text = params.toString();
    if (!text) return { payload: undefined, contentType: undefined };
    return {
      payload: text,
      contentType: "application/x-www-form-urlencoded",
    };
  }
  if (body.kind === "raw") {
    if (!body.text) return { payload: undefined, contentType: undefined };
    return {
      payload: body.text,
      contentType: body.contentType || "text/plain",
    };
  }
  return { payload: undefined, contentType: undefined };
}

const BODY_KINDS: Array<{ id: BodyKind; label: string; disabled?: boolean; hint?: string }> = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "urlencoded", label: "Urlencoded" },
  { id: "raw", label: "Raw" },
  { id: "none", label: "Form", disabled: true, hint: "multipart ships later" },
  { id: "none", label: "Binary", disabled: true, hint: "multipart ships later" },
];

function TabBody(props: {
  value: BodyState;
  onChange: (next: BodyState) => void;
}): JSX.Element {
  const pick = (kind: BodyKind) => {
    if (kind === props.value.kind) return;
    switch (kind) {
      case "none":
        props.onChange({ kind: "none" });
        break;
      case "json":
        props.onChange({ kind: "json", text: "" });
        break;
      case "urlencoded":
        props.onChange({
          kind: "urlencoded",
          rows: [{ name: "", value: "", enabled: true }],
        });
        break;
      case "raw":
        props.onChange({ kind: "raw", text: "", contentType: "text/plain" });
        break;
    }
  };

  return (
    <div
      style={{ display: "flex", "flex-direction": "column", height: "100%" }}
      data-testid="body-tab"
    >
      <div
        style={{
          padding: "8px 16px",
          "border-bottom": "1px solid var(--bd-1)",
          display: "flex",
          "align-items": "center",
          gap: "4px",
          "flex-wrap": "wrap",
        }}
        role="radiogroup"
      >
        <For each={BODY_KINDS}>
          {(k) => {
            const active = () => props.value.kind === k.id && !k.disabled;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={active()}
                aria-label={k.label}
                data-testid={`body-kind-${k.label.toLowerCase()}`}
                title={k.hint ?? k.label}
                disabled={k.disabled}
                onClick={() => pick(k.id)}
                style={{
                  padding: "3px 10px",
                  "font-size": "11px",
                  "border-radius": "3px",
                  background: active() ? "var(--bg-2)" : "transparent",
                  color: active() ? "var(--fg-0)" : "var(--fg-2)",
                  border: active() ? "1px solid var(--bd-2)" : "1px solid transparent",
                  opacity: k.disabled ? 0.4 : 1,
                  cursor: k.disabled ? "not-allowed" : "pointer",
                }}
              >
                {k.label}
              </button>
            );
          }}
        </For>
      </div>

      <Show when={props.value.kind === "none"}>
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
          No body will be sent.
        </div>
      </Show>

      <Show when={props.value.kind === "json"}>
        <JsonBodyEditor
          text={props.value.kind === "json" ? props.value.text : ""}
          onChange={(text) => props.onChange({ kind: "json", text })}
        />
      </Show>

      <Show when={props.value.kind === "urlencoded"}>
        <UrlencodedBodyEditor
          rows={
            props.value.kind === "urlencoded" ? props.value.rows : []
          }
          onChange={(rows) => props.onChange({ kind: "urlencoded", rows })}
        />
      </Show>

      <Show when={props.value.kind === "raw"}>
        <RawBodyEditor
          text={props.value.kind === "raw" ? props.value.text : ""}
          contentType={
            props.value.kind === "raw"
              ? props.value.contentType
              : "text/plain"
          }
          onChange={(text, contentType) =>
            props.onChange({ kind: "raw", text, contentType })
          }
        />
      </Show>
    </div>
  );
}

function JsonBodyEditor(props: {
  text: string;
  onChange: (t: string) => void;
}): JSX.Element {
  const [err, setErr] = createSignal<string | undefined>(undefined);
  const format = () => {
    try {
      const parsed = JSON.parse(props.text || "null");
      props.onChange(JSON.stringify(parsed, null, 2));
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const minify = () => {
    try {
      const parsed = JSON.parse(props.text || "null");
      props.onChange(JSON.stringify(parsed));
      setErr(undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "4px 16px",
          "border-bottom": "1px solid var(--bd-1)",
          "min-height": "28px",
        }}
      >
        <span
          class="mono"
          style={{ "font-size": "10px", color: "var(--fg-3)" }}
        >
          application/json
        </span>
        <div style={{ flex: 1 }} />
        <Show when={err()}>
          <span
            class="mono"
            data-testid="body-json-error"
            style={{ "font-size": "11px", color: "var(--err)" }}
          >
            {err()}
          </span>
        </Show>
        <button
          type="button"
          onClick={format}
          data-testid="body-json-format"
          style={{
            "font-size": "11px",
            color: "var(--fg-2)",
            padding: "2px 8px",
          }}
        >
          Format
        </button>
        <button
          type="button"
          onClick={minify}
          style={{
            "font-size": "11px",
            color: "var(--fg-2)",
            padding: "2px 8px",
          }}
        >
          Minify
        </button>
      </div>
      <textarea
        data-testid="body-input"
        value={props.text}
        onInput={(e) => props.onChange(e.currentTarget.value)}
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

function UrlencodedBodyEditor(props: {
  rows: Array<{ name: string; value: string; enabled: boolean }>;
  onChange: (rows: Array<{ name: string; value: string; enabled: boolean }>) => void;
}): JSX.Element {
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
  const add = () =>
    props.onChange([...props.rows, { name: "", value: "", enabled: true }]);
  return (
    <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "14px 220px 1fr 24px",
          padding: "6px 16px",
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          "border-bottom": "1px solid var(--bd-1)",
          gap: "8px",
        }}
      >
        <div />
        <div>Field</div>
        <div>Value</div>
        <div />
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <For each={props.rows}>
          {(r, i) => (
            <div
              style={{
                display: "grid",
                "grid-template-columns": "14px 220px 1fr 24px",
                padding: "6px 16px",
                "align-items": "center",
                gap: "8px",
                "border-bottom": "1px solid var(--bd-1)",
                opacity: r.enabled ? 1 : 0.5,
              }}
            >
              <Checkbox
                checked={r.enabled}
                onChange={(v) => update(i(), { enabled: v })}
                aria-label={`Include field ${r.name || "(unnamed)"}`}
              />
              <input
                value={r.name}
                placeholder="name"
                disabled={!r.enabled}
                class="mono"
                style={{ "font-size": "12px", width: "100%" }}
                onInput={(e) => update(i(), { name: e.currentTarget.value })}
              />
              <input
                value={r.value}
                placeholder="value"
                disabled={!r.enabled}
                class="mono"
                style={{ "font-size": "12px", width: "100%" }}
                onInput={(e) => update(i(), { value: e.currentTarget.value })}
              />
              <button
                type="button"
                onClick={() => remove(i())}
                style={{ color: "var(--fg-3)" }}
                aria-label="Remove field"
              >
                ×
              </button>
            </div>
          )}
        </For>
        <button
          type="button"
          onClick={add}
          data-testid="body-urlencoded-add"
          style={{
            padding: "8px 16px",
            color: "var(--fg-3)",
            "font-size": "12px",
            display: "flex",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <IconPlus size={11} /> Add field
        </button>
      </div>
    </div>
  );
}

function RawBodyEditor(props: {
  text: string;
  contentType: string;
  onChange: (text: string, contentType: string) => void;
}): JSX.Element {
  return (
    <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 16px",
          "border-bottom": "1px solid var(--bd-1)",
        }}
      >
        <span
          style={{ "font-size": "10px", color: "var(--fg-3)" }}
          class="mono"
        >
          Content-Type
        </span>
        <input
          value={props.contentType}
          onInput={(e) => props.onChange(props.text, e.currentTarget.value)}
          class="mono"
          data-testid="body-raw-content-type"
          placeholder="text/plain"
          style={{
            "font-size": "11px",
            flex: 1,
            "max-width": "280px",
            padding: "3px 6px",
            border: "1px solid var(--bd-2)",
            "border-radius": "3px",
            background: "var(--bg-0)",
          }}
        />
      </div>
      <textarea
        data-testid="body-input"
        value={props.text}
        onInput={(e) => props.onChange(e.currentTarget.value, props.contentType)}
        class="mono"
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

type ResponseTab = "Pretty" | "Raw" | "Headers";

function ResponsePane(props: {
  busy: boolean;
  response: ProxyResponse | undefined;
  error: string | undefined;
}): JSX.Element {
  const [tab, setTab] = createSignal<ResponseTab>("Pretty");
  const rawText = () => {
    const r = props.response;
    if (!r) return "";
    if (typeof r.body === "string") return r.body;
    try {
      return JSON.stringify(r.body, null, 2);
    } catch {
      return String(r.body);
    }
  };
  const contentType = (): string => {
    const r = props.response;
    if (!r) return "";
    const ct = r.headers["content-type"] ?? r.headers["Content-Type"] ?? "";
    return ct.toLowerCase();
  };
  const kind = (): "json" | "xml" | "html" | "text" => {
    const ct = contentType();
    if (ct.includes("json")) return "json";
    if (ct.includes("html")) return "html";
    if (ct.includes("xml")) return "xml";
    // Stringified JSON bodies frequently come back from fetch even when the
    // header was dropped — sniff the first non-whitespace char.
    const t = rawText().trimStart();
    if (t.startsWith("{") || t.startsWith("[")) return "json";
    if (t.startsWith("<")) return "xml";
    return "text";
  };
  const sizeBytes = (): number | undefined => {
    const r = props.response;
    if (!r) return undefined;
    try {
      return new TextEncoder().encode(rawText()).byteLength;
    } catch {
      return undefined;
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
          "flex-wrap": "wrap",
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
                title="Total elapsed time for the proxied request"
                data-testid="response-duration"
              >
                {r().durationMs}ms
              </span>
              <Show when={sizeBytes() !== undefined}>
                <span class="mono" style={{ color: "var(--fg-3)" }}>·</span>
                <span
                  class="mono"
                  style={{ "font-size": "11px", color: "var(--fg-2)" }}
                  data-testid="response-size"
                >
                  {formatBytes(sizeBytes()!)}
                </span>
              </Show>
              <Show when={contentType()}>
                <span class="mono" style={{ color: "var(--fg-3)" }}>·</span>
                <span
                  class="mono"
                  style={{ "font-size": "11px", color: "var(--fg-2)" }}
                >
                  {contentType()}
                </span>
              </Show>
            </>
          )}
        </Show>
      </div>
      <Show when={props.response}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "padding-left": "10px",
            "border-bottom": "1px solid var(--bd-1)",
            "flex-shrink": 0,
          }}
          role="tablist"
        >
          <MiniTab
            active={tab() === "Pretty"}
            onClick={() => setTab("Pretty")}
            label="Pretty"
          />
          <MiniTab
            active={tab() === "Raw"}
            onClick={() => setTab("Raw")}
            label="Raw"
          />
          <MiniTab
            active={tab() === "Headers"}
            onClick={() => setTab("Headers")}
            label="Headers"
          />
        </div>
      </Show>
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
          <Show when={tab() === "Pretty"}>
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
              <Show when={kind() === "json"}>
                <JsonPretty text={rawText()} />
              </Show>
              <Show when={kind() === "xml" || kind() === "html"}>
                <MarkupHighlight text={rawText()} />
              </Show>
              <Show when={kind() === "text"}>{rawText()}</Show>
            </pre>
          </Show>
          <Show when={tab() === "Raw"}>
            <pre
              data-testid="response-body-raw"
              class="mono"
              style={{
                margin: 0,
                padding: "14px 16px",
                "font-size": "12px",
                "line-height": 1.6,
                color: "var(--fg-2)",
                "white-space": "pre-wrap",
                "word-break": "break-word",
              }}
            >
              {rawText()}
            </pre>
          </Show>
          <Show when={tab() === "Headers"}>
            <ResponseHeaders headers={props.response!.headers} />
          </Show>
        </Show>
      </div>
    </div>
  );
}

function ResponseHeaders(props: { headers: Record<string, string> }): JSX.Element {
  const entries = () =>
    Object.entries(props.headers).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div style={{ padding: "8px 0" }} data-testid="response-headers">
      <For each={entries()}>
        {([k, v]) => (
          <div
            class="mono"
            style={{
              display: "grid",
              "grid-template-columns": "220px 1fr",
              gap: "12px",
              padding: "4px 16px",
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
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const AUTH_PRESETS: ReadonlyArray<{ id: AuthPresetKind; label: string }> = [
  { id: "none", label: "None" },
  { id: "basic", label: "Basic" },
  { id: "bearer", label: "Bearer token" },
  { id: "apikey", label: "API key" },
  { id: "oauth2", label: "OAuth2 client" },
];

function TabAuth(props: {
  value: AuthPreset;
  onChange: (next: AuthPreset) => void;
  env: Record<string, string>;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [tokenErr, setTokenErr] = createSignal<string | undefined>(undefined);
  const pick = (kind: AuthPresetKind) => {
    if (kind === props.value.kind) return;
    props.onChange(defaultPreset(kind));
  };
  const refreshToken = async () => {
    const v = props.value;
    if (v.kind !== "oauth2") return;
    setBusy(true);
    setTokenErr(undefined);
    try {
      const next = await fetchOAuth2Token(v, props.env, async (url, body, headers) => {
        const r = await api.sendRequest({ method: "POST", url, headers, body });
        return { status: r.status, body: r.body };
      });
      props.onChange(next);
    } catch (e) {
      setTokenErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ padding: "14px 16px" }} data-testid="auth-tab">
      <div
        style={{
          display: "flex",
          gap: "4px",
          "margin-bottom": "16px",
          background: "var(--bg-2)",
          padding: "3px",
          "border-radius": "5px",
          width: "fit-content",
        }}
        role="radiogroup"
      >
        <For each={AUTH_PRESETS}>
          {(p) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.value.kind === p.id}
              data-testid={`auth-preset-${p.id}`}
              onClick={() => pick(p.id)}
              style={{
                padding: "4px 12px",
                "font-size": "12px",
                "border-radius": "3px",
                background:
                  props.value.kind === p.id ? "var(--bg-0)" : "transparent",
                color:
                  props.value.kind === p.id ? "var(--fg-0)" : "var(--fg-2)",
                border:
                  props.value.kind === p.id
                    ? "1px solid var(--bd-2)"
                    : "1px solid transparent",
              }}
            >
              {p.label}
            </button>
          )}
        </For>
      </div>

      <Show when={props.value.kind === "none"}>
        <div style={{ "font-size": "12px", color: "var(--fg-3)" }}>
          No authentication will be sent with this request.
        </div>
      </Show>

      <Show when={props.value.kind === "basic"}>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "1fr 1fr",
            gap: "10px",
            "max-width": "520px",
          }}
        >
          <Field label="Username">
            <input
              data-testid="auth-basic-username"
              class="mono"
              style={FIELD_STYLE}
              value={
                props.value.kind === "basic" ? props.value.username : ""
              }
              onInput={(e) =>
                props.onChange({
                  ...(props.value as Extract<AuthPreset, { kind: "basic" }>),
                  username: e.currentTarget.value,
                })
              }
            />
          </Field>
          <Field label="Password">
            <input
              data-testid="auth-basic-password"
              class="mono"
              type="password"
              style={FIELD_STYLE}
              value={
                props.value.kind === "basic" ? props.value.password : ""
              }
              onInput={(e) =>
                props.onChange({
                  ...(props.value as Extract<AuthPreset, { kind: "basic" }>),
                  password: e.currentTarget.value,
                })
              }
            />
          </Field>
        </div>
      </Show>

      <Show when={props.value.kind === "bearer"}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            "max-width": "520px",
          }}
        >
          <Field label="Token">
            <input
              data-testid="auth-bearer-token"
              class="mono"
              style={FIELD_STYLE}
              placeholder="{{env.TOKEN}}"
              value={
                props.value.kind === "bearer" ? props.value.token : ""
              }
              onInput={(e) =>
                props.onChange({
                  kind: "bearer",
                  token: e.currentTarget.value,
                })
              }
            />
            <div
              style={{
                "margin-top": "6px",
                "font-size": "11px",
                color: "var(--fg-3)",
              }}
            >
              Supports <span class="mono">{"{{env.VAR}}"}</span> against the
              active environment.
            </div>
          </Field>
        </div>
      </Show>

      <Show when={props.value.kind === "apikey"}>
        <div
          style={{
            "max-width": "520px",
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "4px",
              width: "fit-content",
              background: "var(--bg-2)",
              padding: "3px",
              "border-radius": "4px",
            }}
          >
            <For each={["header", "query"] as const}>
              {(where) => (
                <button
                  type="button"
                  onClick={() =>
                    props.onChange({
                      ...(props.value as Extract<
                        AuthPreset,
                        { kind: "apikey" }
                      >),
                      where,
                    })
                  }
                  style={{
                    padding: "3px 10px",
                    "font-size": "11px",
                    "border-radius": "3px",
                    background:
                      props.value.kind === "apikey" && props.value.where === where
                        ? "var(--bg-0)"
                        : "transparent",
                    color:
                      props.value.kind === "apikey" && props.value.where === where
                        ? "var(--fg-0)"
                        : "var(--fg-2)",
                    border:
                      props.value.kind === "apikey" && props.value.where === where
                        ? "1px solid var(--bd-2)"
                        : "1px solid transparent",
                    "text-transform": "capitalize",
                  }}
                >
                  {where}
                </button>
              )}
            </For>
          </div>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "1fr 2fr",
              gap: "10px",
            }}
          >
            <Field label="Key">
              <input
                data-testid="auth-apikey-name"
                class="mono"
                style={FIELD_STYLE}
                value={
                  props.value.kind === "apikey" ? props.value.name : ""
                }
                onInput={(e) =>
                  props.onChange({
                    ...(props.value as Extract<
                      AuthPreset,
                      { kind: "apikey" }
                    >),
                    name: e.currentTarget.value,
                  })
                }
              />
            </Field>
            <Field label="Value">
              <input
                data-testid="auth-apikey-value"
                class="mono"
                style={FIELD_STYLE}
                placeholder="{{env.API_KEY}}"
                value={
                  props.value.kind === "apikey" ? props.value.value : ""
                }
                onInput={(e) =>
                  props.onChange({
                    ...(props.value as Extract<
                      AuthPreset,
                      { kind: "apikey" }
                    >),
                    value: e.currentTarget.value,
                  })
                }
              />
            </Field>
          </div>
        </div>
      </Show>

      <Show when={props.value.kind === "oauth2"}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            "max-width": "520px",
          }}
        >
          <Field label="Token URL">
            <input
              data-testid="auth-oauth2-url"
              class="mono"
              style={FIELD_STYLE}
              placeholder="https://auth.example.com/token"
              value={
                props.value.kind === "oauth2" ? props.value.tokenUrl : ""
              }
              onInput={(e) =>
                props.onChange({
                  ...(props.value as Extract<AuthPreset, { kind: "oauth2" }>),
                  tokenUrl: e.currentTarget.value,
                })
              }
            />
          </Field>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              gap: "10px",
            }}
          >
            <Field label="Client ID">
              <input
                class="mono"
                style={FIELD_STYLE}
                value={
                  props.value.kind === "oauth2" ? props.value.clientId : ""
                }
                onInput={(e) =>
                  props.onChange({
                    ...(props.value as Extract<AuthPreset, { kind: "oauth2" }>),
                    clientId: e.currentTarget.value,
                  })
                }
              />
            </Field>
            <Field label="Client secret">
              <input
                class="mono"
                type="password"
                style={FIELD_STYLE}
                value={
                  props.value.kind === "oauth2"
                    ? props.value.clientSecret
                    : ""
                }
                onInput={(e) =>
                  props.onChange({
                    ...(props.value as Extract<AuthPreset, { kind: "oauth2" }>),
                    clientSecret: e.currentTarget.value,
                  })
                }
              />
            </Field>
          </div>
          <Field label="Scope">
            <input
              class="mono"
              style={FIELD_STYLE}
              value={props.value.kind === "oauth2" ? props.value.scope : ""}
              onInput={(e) =>
                props.onChange({
                  ...(props.value as Extract<AuthPreset, { kind: "oauth2" }>),
                  scope: e.currentTarget.value,
                })
              }
            />
          </Field>

          <div
            style={{
              "margin-top": "6px",
              padding: "10px 12px",
              background: "var(--bg-2)",
              border: "1px solid var(--bd-1)",
              "border-radius": "5px",
              display: "flex",
              "align-items": "center",
              gap: "10px",
            }}
          >
            <Show
              when={
                props.value.kind === "oauth2" &&
                props.value.cached &&
                props.value.cached.expiresAt > Date.now()
              }
              fallback={
                <>
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      "border-radius": "50%",
                      background: "var(--fg-3)",
                    }}
                  />
                  <div style={{ flex: 1, "font-size": "11px", color: "var(--fg-3)" }}>
                    No cached token.
                  </div>
                </>
              }
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  "border-radius": "50%",
                  background: "var(--ok)",
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ "font-size": "12px" }}>Cached token</div>
                <div
                  class="mono"
                  style={{ "font-size": "11px", color: "var(--fg-3)" }}
                >
                  expires in{" "}
                  {props.value.kind === "oauth2" && props.value.cached
                    ? formatTtl(props.value.cached.expiresAt - Date.now())
                    : "—"}
                </div>
              </div>
            </Show>
            <button
              type="button"
              onClick={() => void refreshToken()}
              disabled={busy()}
              data-testid="auth-oauth2-refresh"
              style={{
                "font-size": "11px",
                color: "var(--fg-1)",
                padding: "4px 10px",
                border: "1px solid var(--bd-2)",
                "border-radius": "4px",
                opacity: busy() ? 0.6 : 1,
                cursor: busy() ? "wait" : "pointer",
              }}
            >
              {busy() ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <Show when={tokenErr()}>
            <div
              data-testid="auth-oauth2-error"
              style={{ "font-size": "11px", color: "var(--err)" }}
            >
              {tokenErr()}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

const FIELD_STYLE: JSX.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  border: "1px solid var(--bd-2)",
  "border-radius": "4px",
  background: "var(--bg-0)",
  "font-size": "12px",
};

function formatTtl(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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

/**
 * Does the resolved URL from a past run match the (baseUrl + templated path)
 * of an endpoint? We treat each `{param}` in the template as a greedy-but-
 * segment-bounded wildcard (no slashes), which handles the common cases.
 */
function matchesUrl(fullUrl: string, baseUrl: string, pathTemplate: string): boolean {
  const expected = `${baseUrl}${pathTemplate}`;
  if (fullUrl === expected) return true;
  const escaped = expected.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+");
  // Allow trailing query string on the captured URL.
  return new RegExp(`^${pattern}(?:\\?.*)?$`).test(fullUrl);
}

/**
 * Collapses the Endpoints form state into the shape SaveAsStepDialog wants:
 * resolved path (with filled-in params), enabled headers, and the serialized
 * body payload (object for JSON, string for urlencoded/raw).
 */
function buildSaveAsStepPayload(
  endpoint: EndpointSummary,
  paramValues: Record<string, string>,
  paramDisabled: Record<string, boolean>,
  headerRows: Array<{ name: string; value: string; enabled: boolean }>,
  body: BodyState,
): SaveAsStepPayload {
  const activeParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(paramValues)) {
    if (!paramDisabled[`path:${k}`]) activeParams[k] = v;
  }
  const path = interpolate(endpoint.path, activeParams);
  const headers: Record<string, string> = {};
  for (const r of headerRows) {
    if (r.enabled && r.name.trim()) headers[r.name.trim()] = r.value;
  }
  let serializedBody: unknown = undefined;
  try {
    serializedBody = serializeBody(body).payload;
  } catch {
    // Invalid JSON — leave body out of the step rather than crashing.
    serializedBody = undefined;
  }
  return {
    endpoint,
    method: endpoint.method,
    path,
    headers,
    ...(serializedBody !== undefined ? { body: serializedBody } : {}),
  };
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
