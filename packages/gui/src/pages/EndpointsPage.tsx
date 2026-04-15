import { createResource, createSignal, For, Show, type Component } from "solid-js";
import { api, type EndpointSummary, type ParameterInfo, type ProxyResponse } from "../api/client";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-amber-400",
  PUT: "text-sky-400",
  PATCH: "text-sky-400",
  DELETE: "text-rose-400",
};

function interpolate(path: string, params: Record<string, string>): string {
  let out = path;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(`{${k}}`, encodeURIComponent(v));
  }
  return out;
}

function paramsByLocation(endpoint: EndpointSummary, loc: ParameterInfo["in"]): ParameterInfo[] {
  // Fallback: if the spec didn't declare path params but the URL template has
  // braces, surface those so users can still fill them in.
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

export const EndpointsPage: Component = () => {
  const [list] = createResource(api.getEndpoints);
  const [selected, setSelected] = createSignal<EndpointSummary | undefined>(undefined);
  const [paramValues, setParamValues] = createSignal<Record<string, string>>({});
  const [queryValues, setQueryValues] = createSignal<Record<string, string>>({});
  const [headers, setHeaders] = createSignal("");
  const [body, setBody] = createSignal("");
  const [response, setResponse] = createSignal<ProxyResponse | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);

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
      let headerObj: Record<string, string> = {};
      if (headers().trim()) {
        headerObj = JSON.parse(headers()) as Record<string, string>;
      }
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
      const res = await api.sendRequest({
        method: ep.method,
        url,
        headers: headerObj,
        ...(bodyVal !== undefined ? { body: bodyVal } : {}),
      });
      setResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="grid grid-cols-[20rem_1fr] gap-6 h-full">
      <aside>
        <h1 class="text-xl font-semibold mb-3">Endpoints</h1>
        <Show when={list()}>
          {(l) => (
            <ul class="space-y-0.5" data-testid="endpoint-list">
              <For each={l().endpoints}>
                {(ep) => (
                  <li>
                    <button
                      type="button"
                      class="w-full text-left px-2 py-1 rounded hover:bg-slate-800 font-mono text-xs flex gap-2"
                      classList={{ "bg-slate-800": selected()?.name === ep.name }}
                      onClick={() => {
                        setSelected(ep);
                        setParamValues({});
                        setQueryValues({});
                        setResponse(undefined);
                        setError(undefined);
                      }}
                    >
                      <span class={`w-14 ${METHOD_COLORS[ep.method] ?? "text-slate-300"}`}>
                        {ep.method}
                      </span>
                      <span class="text-slate-200 truncate">{ep.path}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          )}
        </Show>
      </aside>
      <section class="min-w-0">
        <Show
          when={selected()}
          fallback={<p class="text-slate-400">Select an endpoint on the left.</p>}
        >
          {(ep) => (
            <div class="space-y-4">
              <div class="font-mono">
                <span class={METHOD_COLORS[ep().method] ?? "text-slate-300"}>{ep().method}</span>{" "}
                <span class="text-slate-200">{ep().path}</span>
              </div>
              <Show when={paramsByLocation(ep(), "path").length > 0}>
                <div>
                  <h3 class="text-xs uppercase text-slate-500 mb-2">Path params</h3>
                  <div class="space-y-1">
                    <For each={paramsByLocation(ep(), "path")}>
                      {(param) => (
                        <label class="flex items-center gap-2 font-mono text-sm">
                          <span class="text-slate-400 w-24">{param.name}</span>
                          <input
                            class="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                            data-testid={`param-${param.name}`}
                            value={paramValues()[param.name] ?? ""}
                            onInput={(e) =>
                              setParamValues({
                                ...paramValues(),
                                [param.name]: e.currentTarget.value,
                              })
                            }
                          />
                        </label>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <Show when={paramsByLocation(ep(), "query").length > 0}>
                <div>
                  <h3 class="text-xs uppercase text-slate-500 mb-2">Query params</h3>
                  <div class="space-y-1">
                    <For each={paramsByLocation(ep(), "query")}>
                      {(param) => (
                        <label class="flex items-center gap-2 font-mono text-sm">
                          <span class="text-slate-400 w-24">
                            {param.name}
                            <Show when={param.required}>
                              <span class="text-rose-400">*</span>
                            </Show>
                          </span>
                          <input
                            class="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                            data-testid={`query-${param.name}`}
                            value={queryValues()[param.name] ?? ""}
                            placeholder={param.description ?? ""}
                            onInput={(e) =>
                              setQueryValues({
                                ...queryValues(),
                                [param.name]: e.currentTarget.value,
                              })
                            }
                          />
                        </label>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <div>
                <h3 class="text-xs uppercase text-slate-500 mb-2">Headers (JSON)</h3>
                <textarea
                  class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-sm h-20"
                  data-testid="headers-input"
                  value={headers()}
                  onInput={(e) => setHeaders(e.currentTarget.value)}
                  placeholder='{"Authorization": "Bearer …"}'
                />
              </div>
              <div>
                <h3 class="text-xs uppercase text-slate-500 mb-2">Body (JSON)</h3>
                <textarea
                  class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-sm h-24"
                  data-testid="body-input"
                  value={body()}
                  onInput={(e) => setBody(e.currentTarget.value)}
                />
              </div>
              <button
                type="button"
                class="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
                disabled={busy()}
                onClick={() => void send()}
                data-testid="send-button"
              >
                {busy() ? "Sending…" : "Send"}
              </button>
              <Show when={error()}>
                <p class="text-rose-400 text-sm" data-testid="request-error">
                  {error()}
                </p>
              </Show>
              <Show when={response()}>
                {(r) => (
                  <div data-testid="response-panel" class="border border-slate-800 rounded p-3">
                    <div class="text-sm mb-2">
                      <span class="text-slate-400">Status:</span>{" "}
                      <span data-testid="response-status">{r().status}</span>{" "}
                      <span class="text-slate-500">({r().durationMs}ms)</span>
                    </div>
                    <pre class="text-xs overflow-auto max-h-80" data-testid="response-body">
                      {JSON.stringify(r().body, null, 2)}
                    </pre>
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </section>
    </div>
  );
};
