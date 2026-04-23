import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { IconX, JsonPretty, MiniTab } from "../ui";
import { parseCurl, type ParsedCurl } from "../pages/importCurl";

export type ImportDialogProps = {
  open: boolean;
  onClose: () => void;
};

type ImportTab = "cURL" | "OpenAPI" | "Postman";

/**
 * Paste → parse → launch. cURL is the shipping path today; OpenAPI and Postman
 * tabs render polite stubs with concrete pointers to what's missing. Importing
 * a full OpenAPI doc would replace the project's spec (destructive, needs a
 * confirm flow); Postman collections need a v2.1 parser and a mapping decision
 * for folders.
 */
export function ImportDialog(props: ImportDialogProps): JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<ImportTab>("cURL");
  const [text, setText] = createSignal("");

  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const parsed = createMemo(() => {
    if (tab() !== "cURL" || !text().trim()) return undefined;
    return parseCurl(text());
  });

  const launch = () => {
    const p = parsed();
    if (!p || !p.ok) return;
    const v = p.value;
    navigate(
      `/endpoints?method=${encodeURIComponent(v.method)}&url=${encodeURIComponent(v.url)}`,
    );
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          "z-index": 80,
        }}
      />
      <div
        role="dialog"
        aria-label="Import request"
        data-testid="import-dialog"
        style={{
          position: "fixed",
          top: "12%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(680px, 94vw)",
          "max-height": "76vh",
          background: "var(--bg-1)",
          border: "1px solid var(--bd-2)",
          "border-radius": "6px",
          "box-shadow": "0 20px 60px rgba(0,0,0,0.6)",
          "z-index": 81,
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            padding: "10px 14px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <div style={{ "font-size": "13px", "font-weight": 600 }}>Import</div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={props.onClose}
            style={{ color: "var(--fg-3)" }}
            aria-label="Close"
          >
            <IconX size={13} />
          </button>
        </div>
        <div
          style={{
            display: "flex",
            "padding-left": "10px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <MiniTab
            active={tab() === "cURL"}
            onClick={() => setTab("cURL")}
            label="cURL"
          />
          <MiniTab
            active={tab() === "OpenAPI"}
            onClick={() => setTab("OpenAPI")}
            label="OpenAPI"
          />
          <MiniTab
            active={tab() === "Postman"}
            onClick={() => setTab("Postman")}
            label="Postman"
          />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            padding: "12px 14px",
            overflow: "auto",
          }}
        >
          <Show when={tab() === "cURL"}>
            <textarea
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              placeholder={`curl -X POST 'https://api.example.com/pets' \\\n  -H 'content-type: application/json' \\\n  -d '{"name":"rex"}'`}
              class="mono"
              data-testid="import-curl-input"
              spellcheck={false}
              style={{
                width: "100%",
                "min-height": "140px",
                padding: "10px 12px",
                border: "1px solid var(--bd-2)",
                "border-radius": "4px",
                background: "var(--bg-0)",
                color: "var(--fg-1)",
                "font-size": "12px",
                "line-height": 1.6,
              }}
            />
            <Show when={parsed()}>
              {(r) => (
                <Show
                  when={r().ok}
                  fallback={
                    <div
                      class="mono"
                      data-testid="import-curl-error"
                      style={{ "font-size": "12px", color: "var(--err)" }}
                    >
                      Parse failed: {(r() as { ok: false; error: string }).error}
                    </div>
                  }
                >
                  {(() => {
                    const ok = r() as { ok: true; value: ParsedCurl };
                    return (
                      <>
                        <div
                          style={{
                            "font-size": "10px",
                            color: "var(--fg-3)",
                            "text-transform": "uppercase",
                            "letter-spacing": "0.08em",
                          }}
                        >
                          Preview
                        </div>
                        <pre
                          class="mono"
                          data-testid="import-curl-preview"
                          style={{
                            margin: 0,
                            padding: "10px 14px",
                            "font-size": "11px",
                            "line-height": 1.6,
                            color: "var(--fg-1)",
                            background: "var(--bg-0)",
                            border: "1px solid var(--bd-1)",
                            "border-radius": "4px",
                            "white-space": "pre-wrap",
                            "word-break": "break-word",
                          }}
                        >
                          <JsonPretty
                            text={JSON.stringify(
                              {
                                method: ok.value.method,
                                url: ok.value.url,
                                headers: ok.value.headers,
                                ...(ok.value.body !== undefined
                                  ? { body: ok.value.body }
                                  : {}),
                                ...(ok.value.basicAuth
                                  ? { basicAuth: ok.value.basicAuth }
                                  : {}),
                              },
                              null,
                              2,
                            )}
                          />
                        </pre>
                        <Show when={ok.value.warnings.length > 0}>
                          <ul
                            class="mono"
                            data-testid="import-curl-warnings"
                            style={{
                              "font-size": "11px",
                              color: "var(--warn)",
                              margin: 0,
                              "padding-left": "18px",
                            }}
                          >
                            {ok.value.warnings.map((w) => (
                              <li>{w}</li>
                            ))}
                          </ul>
                        </Show>
                      </>
                    );
                  })()}
                </Show>
              )}
            </Show>
          </Show>
          <Show when={tab() === "OpenAPI"}>
            <div style={{ "font-size": "12px", color: "var(--fg-3)" }}>
              Importing a full OpenAPI spec replaces{" "}
              <span class="mono">openapi.yaml</span> and re-runs{" "}
              <span class="mono">journey generate</span>. Not wired yet —
              drop a spec into the project folder and hit Regenerate on the
              Spec diff page for now.
            </div>
          </Show>
          <Show when={tab() === "Postman"}>
            <div style={{ "font-size": "12px", color: "var(--fg-3)" }}>
              Postman collection v2.1 import isn't wired yet. For single
              requests, export to cURL inside Postman and use the cURL tab.
            </div>
          </Show>
        </div>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "10px 14px",
            "border-top": "1px solid var(--bd-1)",
          }}
        >
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "5px 12px",
              border: "1px solid var(--bd-2)",
              "border-radius": "4px",
              "font-size": "12px",
              color: "var(--fg-1)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={launch}
            disabled={!parsed() || !parsed()?.ok}
            data-testid="import-curl-launch"
            style={{
              padding: "5px 14px",
              background: "var(--ac)",
              color: "#1a1200",
              "border-radius": "4px",
              "font-size": "12px",
              "font-weight": 600,
              opacity: parsed()?.ok ? 1 : 0.5,
            }}
          >
            Open in Endpoints
          </button>
        </div>
      </div>
    </Show>
  );
}
