// Journey — Console dock (request/response stream with filters)
const { useState: uSc } = React;

function ConsoleDock({ open, height, onSetHeight, onClose, onExpand }) {
  const [tab, setTab] = uSc('network');
  const [selectedId, setSelectedId] = uSc('e3');
  const [methodFilter, setMethodFilter] = uSc('all');
  const [statusFilter, setStatusFilter] = uSc('all');
  const [stepFilter, setStepFilter] = uSc('all');
  const [query, setQuery] = uSc('');

  if (!open) return null;

  const entries = CHECKOUT_STEPS.map((s, i) => ({
    id: 'e' + (i + 1),
    step: s.name,
    stepIdx: i + 1,
    method: s.method,
    url: s.url,
    status: s.status,
    ms: s.ms,
    size: s.size,
    body: s.responseBody,
    req: s.requestBody,
    logs: s.logs,
  }));

  const visible = entries.filter(e => {
    if (methodFilter !== 'all' && e.method !== methodFilter) return false;
    if (statusFilter !== 'all') {
      const k = Math.floor(e.status / 100);
      if (`${k}xx` !== statusFilter) return false;
    }
    if (stepFilter !== 'all' && e.step !== stepFilter) return false;
    if (query && !e.url.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const selected = entries.find(e => e.id === selectedId) || visible[0];

  return (
    <div style={{
      height, flexShrink: 0,
      borderTop: '1px solid var(--bd-2)', background: 'var(--bg-0)',
      display: 'flex', flexDirection: 'column', position: 'relative',
    }}>
      {/* resize handle */}
      <div
        onMouseDown={(e) => {
          const startY = e.clientY;
          const startH = height;
          const mv = (ev) => onSetHeight(Math.max(200, Math.min(700, startH + (startY - ev.clientY))));
          const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
        }}
        style={{ position: 'absolute', left: 0, right: 0, top: -3, height: 6, cursor: 'row-resize', zIndex: 2 }}
      />

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 12px', borderBottom: '1px solid var(--bd-1)', height: 36, flexShrink: 0 }}>
        {['network', 'logs', 'timing'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
            color: tab === t ? 'var(--fg-0)' : 'var(--fg-2)',
            borderBottom: tab === t ? '2px solid var(--ac)' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t === 'network' ? <IconConsole size={12}/> : t === 'logs' ? <IconEditor size={12}/> : <IconClock size={12}/>}
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'network' && <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{entries.length}</span>}
            {t === 'logs' && <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{entries.reduce((a, e) => a + e.logs.length, 0)}</span>}
          </button>
        ))}

        <div style={{ flex: 1 }}/>

        {/* filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <FilterChip options={['all', 'GET', 'POST', 'PUT', 'DELETE']} value={methodFilter} onChange={setMethodFilter} icon="method"/>
          <FilterChip options={['all', '2xx', '3xx', '4xx', '5xx']} value={statusFilter} onChange={setStatusFilter} icon="status"/>
          <FilterChip options={['all', ...entries.map(e => e.step)]} value={stepFilter} onChange={setStepFilter} icon="step" short/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', background: 'var(--bg-2)', border: '1px solid var(--bd-1)', borderRadius: 4, width: 140 }}>
            <IconSearch size={11} style={{ color: 'var(--fg-3)' }}/>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="filter" style={{ flex: 1, fontSize: 11 }} className="mono"/>
          </div>
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--bd-1)', margin: '0 6px' }}/>
        <button style={{ color: 'var(--fg-2)', padding: '6px 8px' }} title="Expand"><IconDocked size={12}/></button>
        <button onClick={onClose} style={{ color: 'var(--fg-2)', padding: '6px 8px' }} title="Close"><IconX size={12}/></button>
      </div>

      {/* content */}
      {tab === 'network' && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '50% 50%', minHeight: 0 }}>
          <div style={{ borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '14px 42px 120px 1fr 50px 60px 56px',
              padding: '5px 12px', fontSize: 10, color: 'var(--fg-3)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderBottom: '1px solid var(--bd-1)', gap: 8,
            }}>
              <span></span><span>Method</span><span>Step</span><span>URL</span><span style={{ textAlign: 'right' }}>Status</span><span style={{ textAlign: 'right' }}>Time</span><span style={{ textAlign: 'right' }}>Size</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {visible.map(e => (
                <button key={e.id} onClick={() => setSelectedId(e.id)} style={{
                  width: '100%', display: 'grid', gridTemplateColumns: '14px 42px 120px 1fr 50px 60px 56px',
                  alignItems: 'center', gap: 8, padding: '5px 12px', textAlign: 'left',
                  background: e.id === selectedId ? 'var(--bg-3)' : 'transparent',
                  borderBottom: '1px solid var(--bd-1)',
                }}
                onMouseEnter={ev => { if (e.id !== selectedId) ev.currentTarget.style.background = 'var(--bg-1)'; }}
                onMouseLeave={ev => { if (e.id !== selectedId) ev.currentTarget.style.background = 'transparent'; }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{e.stepIdx}</span>
                  <MethodBadge method={e.method}/>
                  <span style={{ fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.step}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.url}</span>
                  <span style={{ textAlign: 'right' }}><StatusPill status={e.status}/></span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)', textAlign: 'right' }}>{e.ms}ms</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'right' }}>{e.size}</span>
                </button>
              ))}
            </div>
          </div>

          {/* detail */}
          {selected && <ConsoleDetail entry={selected}/>}
        </div>
      )}

      {tab === 'logs' && <ConsoleLogs entries={entries}/>}
      {tab === 'timing' && <ConsoleTiming entries={entries}/>}
    </div>
  );
}

function FilterChip({ options, value, onChange, icon, short }) {
  const [open, setOpen] = uSc(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
        border: '1px solid var(--bd-1)', borderRadius: 3, fontSize: 11,
        background: value !== 'all' ? 'var(--ac-bg)' : 'var(--bg-2)',
        color: value !== 'all' ? 'var(--ac)' : 'var(--fg-2)',
      }} className="mono">
        <IconFilter size={10}/>
        <span>{icon}:{short && value.length > 8 ? value.slice(0, 8) + '…' : value}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }}/>
          <div style={{
            position: 'absolute', top: '100%', marginTop: 3, right: 0, zIndex: 70,
            background: 'var(--bg-1)', border: '1px solid var(--bd-2)', borderRadius: 4,
            padding: 3, minWidth: 120, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            {options.map(opt => (
              <button key={opt} onClick={() => { onChange(opt); setOpen(false); }} style={{
                width: '100%', padding: '4px 8px', textAlign: 'left', fontSize: 11,
                borderRadius: 3, color: opt === value ? 'var(--ac)' : 'var(--fg-1)',
                background: opt === value ? 'var(--ac-bg)' : 'transparent',
              }} className="mono">{opt}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConsoleDetail({ entry }) {
  const [tab, setTab] = uSc('response');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '4px 12px', borderBottom: '1px solid var(--bd-1)', display: 'flex', alignItems: 'center', gap: 0 }}>
        {['request', 'response', 'headers', 'timing', 'logs'].map(t => (
          <MiniTab key={t} label={t[0].toUpperCase() + t.slice(1)} active={tab === t} onClick={() => setTab(t)}
            count={t === 'logs' ? (entry.logs.length || null) : null}/>
        ))}
        <div style={{ flex: 1 }}/>
        <button style={{ fontSize: 10, color: 'var(--fg-2)', padding: '4px 8px', border: '1px solid var(--bd-1)', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconCopy size={10}/> Copy as curl
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 14px', background: 'var(--bg-0)' }}>
        {tab === 'request' && (
          <>
            <KVLine k="METHOD" v={entry.method}/>
            <KVLine k="URL" v={entry.url}/>
            <KVLine k="HOST" v="api.ledger.test:4000"/>
            <div style={{ height: 10 }}/>
            <Section title="Body">
              {entry.req ? (
                <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-1)' }}>
                  <JsonPretty text={JSON.stringify(entry.req, null, 2)}/>
                </pre>
              ) : <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>—</span>}
            </Section>
          </>
        )}
        {tab === 'response' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <StatusPill status={entry.status}/>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>{entry.ms}ms</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{entry.size}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>application/json</span>
            </div>
            <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-1)' }}>
              <JsonPretty text={JSON.stringify(entry.body, null, 2)}/>
            </pre>
          </>
        )}
        {tab === 'headers' && <HeadersList/>}
        {tab === 'timing' && <TimingDetail total={entry.ms}/>}
        {tab === 'logs' && (
          entry.logs.length
            ? entry.logs.map((l, i) => (
              <div key={i} className="mono" style={{ fontSize: 12, padding: '2px 0', color: 'var(--fg-1)' }}>
                <span style={{ color: 'var(--fg-3)' }}>console.log </span>
                {l.text}
              </div>
            ))
            : <div style={{ color: 'var(--fg-3)', fontSize: 12 }}>No script output for this request.</div>
        )}
      </div>
    </div>
  );
}

function KVLine({ k, v }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 10, fontSize: 11, padding: '2px 0' }} className="mono">
      <span style={{ color: 'var(--fg-3)' }}>{k}</span>
      <span style={{ color: 'var(--fg-0)' }}>{v}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function TimingDetail({ total }) {
  const segs = [['DNS', 4, 'var(--info)'], ['TCP', 12, 'var(--m-patch)'], ['TLS', 38, 'var(--ac)'], ['TTFB', 96, 'var(--ok)'], ['Transfer', 22, 'var(--fg-2)']];
  const sum = segs.reduce((a, s) => a + s[1], 0);
  return (
    <div>
      <div style={{ display: 'flex', width: '100%', height: 10, borderRadius: 3, overflow: 'hidden', background: 'var(--bg-2)', marginBottom: 12 }}>
        {segs.map(([l, n, c]) => <div key={l} style={{ width: `${(n/sum)*100}%`, background: c }} title={`${l}: ${n}ms`}/>)}
      </div>
      {segs.map(([l, n, c]) => (
        <div key={l} style={{ display: 'grid', gridTemplateColumns: '10px 100px 60px 1fr', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11 }} className="mono">
          <span style={{ width: 8, height: 8, borderRadius: 2, background: c }}/>
          <span style={{ color: 'var(--fg-2)' }}>{l}</span>
          <span style={{ color: 'var(--fg-1)', textAlign: 'right' }}>{n}ms</span>
          <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${(n/sum)*100}%`, height: '100%', background: c, opacity: 0.5 }}/>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--bd-1)', fontSize: 11, color: 'var(--fg-3)' }} className="mono">
        Total · {total}ms
      </div>
    </div>
  );
}

function ConsoleLogs({ entries }) {
  const all = [];
  entries.forEach((e, i) => {
    all.push({ type: 'http', stepIdx: i + 1, step: e.step, text: `${e.method} ${e.url} → ${e.status} · ${e.ms}ms`, status: e.status });
    e.logs.forEach(l => all.push({ type: 'log', stepIdx: i + 1, step: e.step, text: l.text, level: l.level }));
  });
  all.push({ type: 'info', stepIdx: CHECKOUT_STEPS.length, step: 'checkout-happy-path', text: 'journey finished · 6/6 passed · 842ms', status: 200 });

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '6px 0', background: 'var(--bg-0)', minHeight: 0 }}>
      {all.map((l, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '22px 60px 120px 1fr',
          gap: 10, padding: '3px 14px', fontSize: 12, lineHeight: 1.5,
          borderBottom: '1px solid var(--bd-1)', alignItems: 'baseline',
        }} className="mono">
          <span style={{ color: 'var(--fg-3)', fontSize: 10 }}>{String(i + 1).padStart(2, '0')}</span>
          <span style={{
            color: l.type === 'http' ? (l.status >= 400 ? 'var(--err)' : 'var(--info)')
              : l.type === 'info' ? 'var(--ac)' : 'var(--fg-3)',
            fontSize: 10,
          }}>{l.type === 'http' ? 'HTTP' : l.type === 'info' ? 'info' : 'log'}</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>step/{l.stepIdx}</span>
          <span style={{ color: l.status >= 400 ? 'var(--err)' : 'var(--fg-1)' }}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function ConsoleTiming({ entries }) {
  const total = entries.reduce((a, e) => a + e.ms, 0);
  let offset = 0;
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px', background: 'var(--bg-0)', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Waterfall</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-1)' }}>total {total}ms</span>
      </div>
      {entries.map((e, i) => {
        const startPct = (offset / total) * 100;
        const widthPct = (e.ms / total) * 100;
        offset += e.ms;
        return (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '18px 200px 1fr 60px', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 11 }}>
            <span className="mono" style={{ color: 'var(--fg-3)', textAlign: 'right' }}>{i + 1}</span>
            <span className="mono" style={{ color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.method} {e.url.split('/').slice(-1)[0] || e.url}</span>
            <div style={{ position: 'relative', height: 14, background: 'var(--bg-2)', borderRadius: 2 }}>
              <div style={{
                position: 'absolute', left: `${startPct}%`, width: `${widthPct}%`, top: 0, bottom: 0,
                background: e.status >= 400 ? 'var(--err)' : 'var(--ac)',
                borderRadius: 2,
              }}/>
            </div>
            <span className="mono" style={{ color: 'var(--fg-2)', textAlign: 'right' }}>{e.ms}ms</span>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { ConsoleDock });
