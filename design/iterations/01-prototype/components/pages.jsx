// Journey — Overview, Endpoints, Journey Runner pages
const { useState: uS, useEffect: uE, useRef: uR, useMemo: uM } = React;

// ───────────────────────────────── OVERVIEW ─────────────────────────────────

function PageOverview({ onNavigate, onRunJourney }) {
  const recentRuns = RECENT_RUNS.slice(0, 6);
  const passCount = RECENT_RUNS.filter(r => r.status === 'pass').length;
  return (
    <div style={{ padding: '24px 32px', overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>ledger-api</h1>
        <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 12 }}>~/work/ledger/api</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 28 }}>
        Payments, accounts, transfers. OpenAPI 3.1. <span className="mono">api.ledger.test:4000</span>
      </div>

      {/* stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--bd-1)', border: '1px solid var(--bd-1)', borderRadius: 6, marginBottom: 28 }}>
        <Stat label="Endpoints"      value={LEDGER_ENDPOINTS.length}       sub="18 generated"/>
        <Stat label="Journeys"       value={LEDGER_JOURNEYS.length}        sub="6 files · 34 steps"/>
        <Stat label="Environments"   value={LEDGER_ENVS.length}            sub="local · staging · ci"/>
        <Stat label="Last 24h runs"  value={RECENT_RUNS.length}            sub={`${passCount} passed · ${RECENT_RUNS.length - passCount} failed`} valueColor={RECENT_RUNS.length - passCount ? 'var(--err)' : 'var(--fg-0)'}/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        {/* recent runs */}
        <Panel title="Recent runs" action={<button onClick={() => onNavigate('journeys')} style={{ color: 'var(--fg-2)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}>View all <IconChevron size={10}/></button>}>
          <div>
            {recentRuns.map((r, i) => (
              <div key={r.id} style={{
                display: 'grid', gridTemplateColumns: '16px 1fr 80px 60px 60px 24px',
                alignItems: 'center', gap: 12, padding: '8px 12px',
                borderTop: i === 0 ? 'none' : '1px solid var(--bd-1)',
                fontSize: 12,
              }}>
                <RunDot state={r.status}/>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className="mono" style={{ color: 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.journey}</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', border: '1px solid var(--bd-2)', padding: '0 4px', borderRadius: 2 }} className="mono">{r.env}</span>
                </div>
                <span className="mono" style={{ color: 'var(--fg-3)' }}>{r.commit}</span>
                <span className="mono" style={{ color: 'var(--fg-2)', textAlign: 'right' }}>{r.ms}ms</span>
                <span className="mono" style={{ color: 'var(--fg-3)', textAlign: 'right' }}>{r.ago}</span>
                <button style={{ color: 'var(--fg-3)' }} onClick={() => onRunJourney(r.journey)}><IconChevron size={11}/></button>
              </div>
            ))}
          </div>
        </Panel>

        {/* quick actions + health */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Panel title="Quick actions">
            <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <QAButton icon={IconPlay}      label="Run all smoke"      sub="3 journeys"   onClick={() => onRunJourney('checkout-happy-path')}/>
              <QAButton icon={IconEndpoints} label="Send request"       sub="endpoints"    onClick={() => onNavigate('endpoints')}/>
              <QAButton icon={IconRefresh}   label="Regenerate"         sub="from openapi"/>
              <QAButton icon={IconPlus}      label="New journey"        sub="from skeleton"/>
            </div>
          </Panel>

          <Panel title="Spec drift" badge="2">
            <div style={{ padding: '2px 12px 10px' }}>
              <DriftRow method="POST" path="/v1/payments" change="+1 field" detail="payment_method_options"/>
              <DriftRow method="GET"  path="/v1/accounts/{id}" change="~ schema" detail="balance → pending/available"/>
              <button style={{ marginTop: 6, fontSize: 11, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <IconRefresh size={11}/> Run <span className="mono">journey generate</span>
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, valueColor }) {
  return (
    <div style={{ background: 'var(--bg-1)', padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 500, color: valueColor || 'var(--fg-0)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }} className="mono">{sub}</div>
    </div>
  );
}

function Panel({ title, action, badge, children }) {
  return (
    <div style={{ border: '1px solid var(--bd-1)', borderRadius: 6, background: 'var(--bg-1)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--bd-1)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-0)' }}>{title}</div>
        {badge && <span className="mono" style={{ fontSize: 10, color: 'var(--ac)', background: 'var(--ac-bg)', padding: '0 5px', borderRadius: 8 }}>{badge}</span>}
        <div style={{ flex: 1 }}/>
        {action}
      </div>
      {children}
    </div>
  );
}

function QAButton({ icon: Icon, label, sub, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', border: '1px solid var(--bd-1)', borderRadius: 5,
      textAlign: 'left', background: 'var(--bg-0)',
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--bd-3)'}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bd-1)'}>
      <Icon size={14} style={{ color: 'var(--ac)' }}/>
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg-0)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)' }} className="mono">{sub}</div>
      </div>
    </button>
  );
}

function DriftRow({ method, path, change, detail }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed var(--bd-1)', fontSize: 11 }}>
      <MethodBadge method={method}/>
      <span className="mono" style={{ color: 'var(--fg-1)' }}>{path}</span>
      <span style={{ flex: 1 }}/>
      <span className="mono" style={{ color: 'var(--ac)' }}>{change}</span>
      <span className="mono" style={{ color: 'var(--fg-3)' }}>{detail}</span>
    </div>
  );
}

// ───────────────────────────────── ENDPOINTS ─────────────────────────────────

function PageEndpoints({ onSendRequest, onSaveToJourney }) {
  const [selectedIdx, setSelectedIdx] = uS(2); // Retrieve payment
  const [tab, setTab] = uS('params');
  const [filter, setFilter] = uS('');
  const [authType, setAuthType] = uS('bearer');
  const [sentOnce, setSentOnce] = uS(true);

  const selected = LEDGER_ENDPOINTS[selectedIdx];

  const grouped = uM(() => {
    const g = {};
    LEDGER_ENDPOINTS.forEach((e, i) => {
      if (filter && !e.path.toLowerCase().includes(filter.toLowerCase())) return;
      (g[e.tag] ||= []).push({ ...e, _i: i });
    });
    return g;
  }, [filter]);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* endpoint list */}
      <div style={{ width: 280, borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}>
        <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--bd-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', border: '1px solid var(--bd-1)', borderRadius: 4, padding: '5px 8px' }}>
            <IconSearch size={12} style={{ color: 'var(--fg-3)' }}/>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter…" style={{ flex: 1, fontSize: 12 }} className="mono"/>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {Object.entries(grouped).map(([tag, items]) => (
            <div key={tag}>
              <div style={{ padding: '8px 14px 4px', fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{tag}</div>
              {items.map(e => (
                <button key={e._i} onClick={() => setSelectedIdx(e._i)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 14px', background: e._i === selectedIdx ? 'var(--bg-3)' : 'transparent',
                  borderLeft: e._i === selectedIdx ? '2px solid var(--ac)' : '2px solid transparent',
                  textAlign: 'left', fontSize: 12, color: e.deprecated ? 'var(--fg-3)' : 'var(--fg-1)',
                }}
                onMouseEnter={ev => { if (e._i !== selectedIdx) ev.currentTarget.style.background = 'var(--bg-1)'; }}
                onMouseLeave={ev => { if (e._i !== selectedIdx) ev.currentTarget.style.background = 'transparent'; }}>
                  <MethodBadge method={e.method}/>
                  <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: e.deprecated ? 'line-through' : 'none' }}>{e.path}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* detail */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* address bar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bd-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--bd-2)', borderRadius: 5, padding: '0 10px 0 10px', background: 'var(--bg-1)', flex: 1 }}>
            <MethodBadge method={selected.method} size="lg"/>
            <div style={{ width: 1, height: 20, background: 'var(--bd-2)' }}/>
            <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 12, padding: '8px 0' }}>{`{{baseUrl}}`}</span>
            <span className="mono" style={{ color: 'var(--fg-0)', fontSize: 13, padding: '8px 0' }}>{selected.path}</span>
            <div style={{ flex: 1 }}/>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{selected.summary}</span>
          </div>
          <button onClick={onSendRequest} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            background: 'var(--ac)', color: '#1a1200', borderRadius: 5, fontWeight: 600, fontSize: 12,
          }}>
            <IconPlay size={11}/> Send
          </button>
          <button onClick={onSaveToJourney} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: '1px solid var(--bd-2)', borderRadius: 5, fontSize: 12, color: 'var(--fg-1)' }}>
            <IconPlus size={11}/> Save as step
          </button>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px solid var(--bd-2)', borderRadius: 5, fontSize: 12, color: 'var(--fg-2)' }}>
            <IconCopy size={11}/> curl
          </button>
        </div>

        {/* tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--bd-1)', paddingLeft: 12, gap: 0, flexShrink: 0 }}>
          {[
            ['params', 'Params', 3],
            ['headers', 'Headers', 4],
            ['auth', 'Auth', null],
            ['body', 'Body', null],
            ['scripts', 'Scripts', 2],
            ['docs', 'Docs', null],
          ].map(([id, label, count]) => (
            <TabButton key={id} active={tab === id} onClick={() => setTab(id)} label={label} count={count}/>
          ))}
        </div>

        {/* split: request config + response */}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: '1fr 1fr' }}>
          <div style={{ overflow: 'auto', borderBottom: '1px solid var(--bd-1)' }}>
            {tab === 'params' && <TabParams/>}
            {tab === 'headers' && <TabHeaders/>}
            {tab === 'auth' && <TabAuth authType={authType} setAuthType={setAuthType}/>}
            {tab === 'body' && <TabBody endpoint={selected}/>}
            {tab === 'scripts' && <TabScripts/>}
            {tab === 'docs' && <TabDocs endpoint={selected}/>}
          </div>
          <ResponsePane sent={sentOnce}/>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, count }) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 12, color: active ? 'var(--fg-0)' : 'var(--fg-2)',
      borderBottom: active ? '2px solid var(--ac)' : '2px solid transparent',
      marginBottom: -1,
    }}>
      {label}
      {count != null && <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{count}</span>}
    </button>
  );
}

// Reusable key-value table
function KVTable({ rows, columns, addLabel = 'Add row' }) {
  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: columns.template,
        padding: '6px 16px', fontSize: 10, color: 'var(--fg-3)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        borderBottom: '1px solid var(--bd-1)', gap: 8,
      }}>
        {columns.headers.map((h, i) => <div key={i}>{h}</div>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: columns.template,
          padding: '6px 16px', alignItems: 'center', gap: 8,
          borderBottom: '1px solid var(--bd-1)',
          opacity: r.enabled === false ? 0.5 : 1,
        }}>
          {r.cells.map((c, j) => <div key={j} style={{ minWidth: 0 }}>{c}</div>)}
        </div>
      ))}
      <button style={{ padding: '8px 16px', color: 'var(--fg-3)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconPlus size={11}/> {addLabel}
      </button>
    </div>
  );
}

function Checkbox({ checked, onChange }) {
  return (
    <button onClick={() => onChange?.(!checked)} style={{
      width: 13, height: 13, borderRadius: 2,
      border: `1px solid ${checked ? 'var(--ac)' : 'var(--bd-3)'}`,
      background: checked ? 'var(--ac)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {checked && <svg width="9" height="9" viewBox="0 0 9 9"><path d="M1.5 4.5L3.5 6.5L7.5 2" stroke="#1a1200" strokeWidth="1.5" fill="none" strokeLinecap="square"/></svg>}
    </button>
  );
}

function TableInput({ value, placeholder, mono = true, dim }) {
  const [v, setV] = uS(value || '');
  return (
    <input value={v} onChange={e => setV(e.target.value)} placeholder={placeholder}
      className={mono ? 'mono' : ''}
      style={{ width: '100%', fontSize: 12, color: dim ? 'var(--fg-3)' : 'var(--fg-0)', padding: '3px 0' }}/>
  );
}

function TypeHint({ t, required }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10 }} className="mono">
      <span style={{ color: 'var(--fg-3)' }}>{t}</span>
      {required && <span style={{ color: 'var(--ac)', fontSize: 9 }}>required</span>}
    </span>
  );
}

function TabParams() {
  const [rows, setRows] = uS([
    { enabled: true,  loc: 'path',  name: 'id',       type: 'string',  required: true, value: '{{paymentId}}', desc: 'Unique payment identifier' },
    { enabled: true,  loc: 'query', name: 'expand',   type: 'string[]', required: false, value: 'charges', desc: 'Related objects to expand' },
    { enabled: false, loc: 'query', name: 'include',  type: 'string',  required: false, value: '', desc: 'Deprecated in v1.3' },
  ]);
  const toggle = (i) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, enabled: !r.enabled } : r));

  return (
    <KVTable
      columns={{
        template: '14px 50px 160px 100px 1fr 160px 18px',
        headers: ['', 'In', 'Key', 'Type', 'Value', 'Description', ''],
      }}
      rows={rows.map((r, i) => ({
        enabled: r.enabled,
        cells: [
          <Checkbox checked={r.enabled} onChange={() => toggle(i)}/>,
          <span className="mono" style={{ fontSize: 11, color: r.loc === 'path' ? 'var(--info)' : 'var(--fg-2)', textTransform: 'uppercase' }}>{r.loc}</span>,
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--fg-0)', fontWeight: 500 }}>{r.name}</span>
            {r.required && <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--ac)' }}/>}
          </div>,
          <TypeHint t={r.type}/>,
          <TableInput value={r.value} placeholder="value"/>,
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{r.desc}</span>,
          <button style={{ color: 'var(--fg-3)' }}><IconX size={10}/></button>,
        ]
      }))}
    />
  );
}

function TabHeaders() {
  const [rows, setRows] = uS([
    { enabled: true, name: 'Authorization',    value: 'Bearer {{env.TOKEN}}', desc: 'From Auth tab', fromSpec: false, masked: true },
    { enabled: true, name: 'Idempotency-Key',  value: '{{crypto.uuid()}}',    desc: 'Recommended',   fromSpec: true,  masked: false },
    { enabled: true, name: 'Accept',           value: 'application/json',     desc: '',              fromSpec: true,  masked: false },
    { enabled: false, name: 'X-Ledger-Version', value: '2026-03-15',          desc: 'Pin API version', fromSpec: true, masked: false },
  ]);
  const toggle = (i) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, enabled: !r.enabled } : r));

  return (
    <KVTable
      columns={{ template: '14px 220px 1fr 160px 18px', headers: ['', 'Header', 'Value', 'Source', ''] }}
      rows={rows.map((r, i) => ({
        enabled: r.enabled,
        cells: [
          <Checkbox checked={r.enabled} onChange={() => toggle(i)}/>,
          <span className="mono" style={{ fontSize: 12, color: 'var(--fg-0)' }}>{r.name}</span>,
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TableInput value={r.masked ? '••••••••••••••••' : r.value}/>
            {r.masked && <button style={{ color: 'var(--fg-3)' }}><IconEye size={12}/></button>}
          </div>,
          <span style={{ fontSize: 10, color: r.fromSpec ? 'var(--fg-3)' : 'var(--ac)' }} className="mono">{r.fromSpec ? 'from spec' : 'manual'}</span>,
          <button style={{ color: 'var(--fg-3)' }}><IconX size={10}/></button>,
        ]
      }))}
    />
  );
}

function TabAuth({ authType, setAuthType }) {
  const presets = [
    { id: 'none',    label: 'None' },
    { id: 'basic',   label: 'Basic' },
    { id: 'bearer',  label: 'Bearer token' },
    { id: 'apikey',  label: 'API key' },
    { id: 'oauth2',  label: 'OAuth2 client' },
  ];
  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-2)', padding: 3, borderRadius: 5, width: 'fit-content' }}>
        {presets.map(p => (
          <button key={p.id} onClick={() => setAuthType(p.id)} style={{
            padding: '4px 12px', fontSize: 12, borderRadius: 3,
            background: authType === p.id ? 'var(--bg-0)' : 'transparent',
            color: authType === p.id ? 'var(--fg-0)' : 'var(--fg-2)',
            border: authType === p.id ? '1px solid var(--bd-2)' : '1px solid transparent',
          }}>{p.label}</button>
        ))}
      </div>

      {authType === 'bearer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
          <Field label="Token">
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="mono" defaultValue="{{env.TOKEN}}" style={FIELD_STYLE}/>
              <button style={ICON_BTN}><IconEye size={13}/></button>
            </div>
            <div style={HELP_STYLE}>Resolves to <span className="mono" style={{ color: 'var(--fg-1)' }}>sk_test_••••7Yq2</span> from <span className="mono" style={{ color: 'var(--ac)' }}>environments/local.json</span></div>
          </Field>
        </div>
      )}

      {authType === 'oauth2' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
          <Field label="Token URL">
            <input className="mono" defaultValue="{{baseUrl}}/oauth/token" style={FIELD_STYLE}/>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Client ID">
              <input className="mono" defaultValue="ledger_client_01" style={FIELD_STYLE}/>
            </Field>
            <Field label="Client secret">
              <input className="mono" defaultValue="••••••••••••" style={FIELD_STYLE}/>
            </Field>
          </div>
          <Field label="Scope">
            <input className="mono" defaultValue="payments:write accounts:read" style={FIELD_STYLE}/>
          </Field>

          <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--bd-1)', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)' }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12 }}>Cached token</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }} className="mono">expires in 42m · issued 18m ago</div>
            </div>
            <button style={{ fontSize: 11, color: 'var(--fg-1)', padding: '4px 8px', border: '1px solid var(--bd-2)', borderRadius: 4 }}>Refresh</button>
          </div>
        </div>
      )}

      {authType === 'none' && <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No authentication will be sent with this request.</div>}
      {authType === 'basic' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 520 }}>
          <Field label="Username"><input style={FIELD_STYLE} defaultValue="ada"/></Field>
          <Field label="Password"><input style={FIELD_STYLE} type="password" defaultValue="secret"/></Field>
        </div>
      )}
      {authType === 'apikey' && (
        <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4, width: 'fit-content', background: 'var(--bg-2)', padding: 3, borderRadius: 4 }}>
            <button style={{ padding: '3px 10px', fontSize: 11, borderRadius: 3, background: 'var(--bg-0)', color: 'var(--fg-0)', border: '1px solid var(--bd-2)' }}>Header</button>
            <button style={{ padding: '3px 10px', fontSize: 11, color: 'var(--fg-2)' }}>Query</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <Field label="Key"><input className="mono" defaultValue="X-Api-Key" style={FIELD_STYLE}/></Field>
            <Field label="Value"><input className="mono" defaultValue="{{env.API_KEY}}" style={FIELD_STYLE}/></Field>
          </div>
        </div>
      )}
    </div>
  );
}

const FIELD_STYLE = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--bd-2)',
  borderRadius: 4, background: 'var(--bg-0)', fontSize: 12,
};
const ICON_BTN = {
  padding: '7px 10px', border: '1px solid var(--bd-2)', borderRadius: 4, color: 'var(--fg-2)',
};
const HELP_STYLE = { marginTop: 6, fontSize: 11, color: 'var(--fg-3)' };

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      {children}
    </label>
  );
}

function TabBody({ endpoint }) {
  const body = `{
  "amount_to_capture": 12900,
  "metadata": {
    "order_id": "ord_0191",
    "notes": "partial capture disabled"
  }
}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid var(--bd-1)', alignItems: 'center' }}>
        {['JSON', 'Form', 'Urlencoded', 'Raw', 'Binary'].map((t, i) => (
          <button key={t} style={{
            padding: '3px 10px', fontSize: 11, borderRadius: 3,
            background: i === 0 ? 'var(--bg-2)' : 'transparent',
            color: i === 0 ? 'var(--fg-0)' : 'var(--fg-2)',
          }}>{t}</button>
        ))}
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 10, color: 'var(--fg-3)' }} className="mono">validates against <span style={{ color: 'var(--ac)' }}>CapturePaymentRequest</span></span>
        <button style={{ fontSize: 11, color: 'var(--fg-2)' }}>Format</button>
      </div>
      <pre className="mono" style={{
        flex: 1, margin: 0, padding: '14px 16px', fontSize: 12, lineHeight: 1.7,
        color: 'var(--fg-1)', background: 'var(--bg-0)', overflow: 'auto',
      }}>
        <JsonPretty text={body}/>
      </pre>
    </div>
  );
}

function JsonPretty({ text }) {
  // very simple colorizer
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j++;
      const str = text.slice(i, j + 1);
      const afterWS = text.slice(j + 1).match(/^\s*:/);
      tokens.push(<span key={tokens.length} style={{ color: afterWS ? 'var(--info)' : 'var(--ok)' }}>{str}</span>);
      i = j + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      tokens.push(<span key={tokens.length} style={{ color: 'var(--ac)' }}>{text.slice(i, j)}</span>);
      i = j;
    } else if (/[a-z]/.test(c)) {
      let j = i;
      while (j < text.length && /[a-z]/.test(text[j])) j++;
      const w = text.slice(i, j);
      if (['true', 'false', 'null'].includes(w)) {
        tokens.push(<span key={tokens.length} style={{ color: 'var(--m-patch)' }}>{w}</span>);
      } else tokens.push(w);
      i = j;
    } else {
      tokens.push(<span key={tokens.length} style={{ color: 'var(--fg-2)' }}>{c}</span>);
      i++;
    }
  }
  return <>{tokens}</>;
}

function TabScripts() {
  const pre = `// pre-request: compute HMAC signature
ctx.headers.set(
  'X-Signature',
  crypto.hmac('sha256', env.SECRET, ctx.body)
);`;
  const post = `// post-response: extract & assert
const pay = res.data;
expect(pay.status).toBe('succeeded');
expect(pay.amount_captured).toBe(pay.amount);
ctx.extract('lastCaptureId', pay.id);`;
  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', height: '100%' }}>
      <ScriptBox title="Pre-request" code={pre}/>
      <ScriptBox title="Post-response" code={post} borderTop/>
    </div>
  );
}
function ScriptBox({ title, code, borderTop }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: borderTop ? '1px solid var(--bd-1)' : 'none' }}>
      <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--bd-1)' }}>{title}</div>
      <pre className="mono" style={{ flex: 1, margin: 0, padding: '10px 16px', fontSize: 12, lineHeight: 1.6, color: 'var(--fg-1)', overflow: 'auto' }}>{code}</pre>
    </div>
  );
}

function TabDocs({ endpoint }) {
  return (
    <div style={{ padding: '18px 20px', maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <MethodBadge method={endpoint.method} size="lg"/>
        <span className="mono" style={{ fontSize: 14 }}>{endpoint.path}</span>
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '10px 0 8px' }}>{endpoint.summary}</h2>
      <p style={{ color: 'var(--fg-2)', fontSize: 12, margin: 0 }}>
        Returns the <span className="mono" style={{ color: 'var(--ac)' }}>Payment</span> object whose id matches the
        parameter. Expand <span className="mono">charges</span> or <span className="mono">refunds</span> to inline
        related objects.
      </p>
      <div style={{ marginTop: 18, padding: '10px 14px', border: '1px solid var(--bd-1)', borderRadius: 5, fontSize: 11, color: 'var(--fg-3)' }}>
        Source: <span className="mono" style={{ color: 'var(--fg-1)' }}>openapi.yaml</span> · line 412 · last regenerated 2h ago
      </div>
    </div>
  );
}

function ResponsePane({ sent }) {
  const [tab, setTab] = uS('pretty');
  if (!sent) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
        Send a request to see the response here.
      </div>
    );
  }
  const resp = `{
  "id": "pay_01HT9K3P8E2X",
  "object": "payment",
  "amount": 12900,
  "amount_captured": 12900,
  "currency": "USD",
  "status": "succeeded",
  "account": "acc_01HT9K3M",
  "payment_method": "pm_card_visa",
  "captured_at": 1713488424,
  "metadata": { "order_id": "ord_0191" }
}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-0)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--bd-1)' }}>
        <StatusPill status={200}/>
        <span style={{ fontSize: 11, color: 'var(--fg-2)' }} className="mono">172ms</span>
        <span style={{ color: 'var(--fg-3)' }} className="mono">·</span>
        <span style={{ fontSize: 11, color: 'var(--fg-2)' }} className="mono">698 B</span>
        <span style={{ color: 'var(--fg-3)' }} className="mono">·</span>
        <span style={{ fontSize: 11, color: 'var(--fg-2)' }} className="mono">application/json</span>
        <div style={{ flex: 1 }}/>
        <TimingBreakdown total={172} segments={[['DNS', 4], ['TCP', 12], ['TLS', 38], ['TTFB', 96], ['Transfer', 22]]}/>
      </div>
      <div style={{ display: 'flex', gap: 0, padding: '0 12px', borderBottom: '1px solid var(--bd-1)' }}>
        {['pretty', 'raw', 'headers', 'preview'].map(t => (
          <TabButton key={t} active={tab === t} onClick={() => setTab(t)} label={t[0].toUpperCase() + t.slice(1)}/>
        ))}
        <div style={{ flex: 1 }}/>
        <button style={{ padding: '8px 10px', color: 'var(--fg-2)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconCopy size={11}/> Copy
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'pretty' && (
          <pre className="mono" style={{ margin: 0, padding: '14px 16px', fontSize: 12, lineHeight: 1.7, color: 'var(--fg-1)' }}>
            <JsonPretty text={resp}/>
          </pre>
        )}
        {tab === 'raw' && (
          <pre className="mono" style={{ margin: 0, padding: '14px 16px', fontSize: 12, color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>{resp.replace(/\s+/g, ' ')}</pre>
        )}
        {tab === 'headers' && <HeadersList/>}
        {tab === 'preview' && <div style={{ padding: 20, color: 'var(--fg-3)', fontSize: 12 }}>No preview available for application/json.</div>}
      </div>
    </div>
  );
}

function TimingBreakdown({ total, segments }) {
  const sum = segments.reduce((a, [, n]) => a + n, 0);
  const colors = ['var(--info)', 'var(--m-patch)', 'var(--ac)', 'var(--ok)', 'var(--fg-2)'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }} className="mono">
      <div style={{ display: 'flex', width: 160, height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--bg-2)' }}>
        {segments.map(([label, n], i) => (
          <div key={label} style={{ width: `${(n / sum) * 100}%`, background: colors[i] }} title={`${label}: ${n}ms`}/>
        ))}
      </div>
      <span style={{ color: 'var(--fg-3)' }}>{total}ms</span>
    </div>
  );
}

function HeadersList() {
  const items = [
    ['content-type', 'application/json; charset=utf-8'],
    ['content-length', '698'],
    ['x-ledger-request-id', 'req_01HT9K3PA2QZ'],
    ['x-ratelimit-remaining', '98'],
    ['x-ratelimit-limit', '100'],
    ['date', 'Sun, 19 Apr 2026 14:22:04 GMT'],
    ['strict-transport-security', 'max-age=63072000'],
  ];
  return (
    <div style={{ padding: '4px 0' }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, padding: '5px 16px', fontSize: 12 }} className="mono">
          <span style={{ color: 'var(--info)' }}>{k}</span>
          <span style={{ color: 'var(--fg-1)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { PageOverview, PageEndpoints, MethodBadge, StatusPill, JsonPretty, Checkbox });
