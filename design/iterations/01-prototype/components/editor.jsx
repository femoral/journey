// Journey — Editor, Files, Environments pages
const { useState: uSe } = React;

// ─────────────────────────────── EDITOR ───────────────────────────────

function PageEditor() {
  const [mode, setMode] = uSe('visual'); // visual | source
  const [selectedStep, setSelectedStep] = uSe('s3');
  const [draggingId, setDraggingId] = uSe(null);
  const [overId, setOverId] = uSe(null);
  const [steps, setSteps] = uSe(() => CHECKOUT_STEPS.map(s => ({ ...s })));

  const selected = steps.find(s => s.id === selectedStep) || steps[0];

  const reorder = (from, to) => {
    if (from === to) return;
    setSteps(s => {
      const next = [...s];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--bd-1)' }}>
        <IconEditor size={14} style={{ color: 'var(--ac)' }}/>
        <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>journeys/checkout-happy-path.journey.ts</span>
        <span style={{ fontSize: 10, color: 'var(--ac)', background: 'var(--ac-bg)', padding: '1px 6px', borderRadius: 2 }} className="mono">modified</span>
        <div style={{ flex: 1 }}/>

        <div style={{ display: 'flex', gap: 2, background: 'var(--bg-2)', padding: 2, borderRadius: 4 }}>
          <button onClick={() => setMode('visual')} style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 3,
            background: mode === 'visual' ? 'var(--bg-0)' : 'transparent',
            color: mode === 'visual' ? 'var(--fg-0)' : 'var(--fg-2)',
            border: mode === 'visual' ? '1px solid var(--bd-2)' : '1px solid transparent',
            display: 'flex', alignItems: 'center', gap: 5,
          }}><IconLayers size={11}/> Visual</button>
          <button onClick={() => setMode('source')} style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 3,
            background: mode === 'source' ? 'var(--bg-0)' : 'transparent',
            color: mode === 'source' ? 'var(--fg-0)' : 'var(--fg-2)',
            border: mode === 'source' ? '1px solid var(--bd-2)' : '1px solid transparent',
            display: 'flex', alignItems: 'center', gap: 5,
          }} className="mono">{`</>`} Source</button>
        </div>

        <button style={{ padding: '5px 10px', border: '1px solid var(--bd-2)', borderRadius: 4, fontSize: 11, color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <IconPlay size={11}/> Run
        </button>
        <button style={{ padding: '5px 12px', background: 'var(--ac)', color: '#1a1200', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
          Save
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {mode === 'visual' ? (
          <>
            {/* step list */}
            <div style={{ width: 340, borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--bd-1)' }}>
                <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Steps · {steps.length}</span>
                <div style={{ flex: 1 }}/>
                <button style={{ fontSize: 11, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <IconPlus size={11}/> Add step
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '6px 10px 10px' }}>
                {steps.map((s, i) => (
                  <DraggableStep
                    key={s.id}
                    step={s}
                    index={i}
                    active={s.id === selectedStep}
                    isDragging={draggingId === s.id}
                    isOver={overId === s.id && draggingId !== s.id}
                    onClick={() => setSelectedStep(s.id)}
                    onDragStart={() => setDraggingId(s.id)}
                    onDragEnter={() => setOverId(s.id)}
                    onDrop={() => {
                      if (draggingId && overId && draggingId !== overId) {
                        const from = steps.findIndex(x => x.id === draggingId);
                        const to = steps.findIndex(x => x.id === overId);
                        reorder(from, to);
                      }
                      setDraggingId(null); setOverId(null);
                    }}
                    onDragEnd={() => { setDraggingId(null); setOverId(null); }}
                  />
                ))}
                <button style={{
                  width: '100%', padding: '10px', fontSize: 11, color: 'var(--fg-3)',
                  border: '1px dashed var(--bd-2)', borderRadius: 4, marginTop: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <IconPlus size={11}/> New step from skeleton
                </button>
              </div>

              {/* journey-level config */}
              <div style={{ borderTop: '1px solid var(--bd-1)', padding: '10px 14px', background: 'var(--bg-1)' }}>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Journey variables</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {['accountId', 'transferId', 'paymentId'].map(v => (
                    <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }} className="mono">
                      <IconDot size={8} style={{ color: 'var(--ac)' }}/>
                      <span style={{ color: 'var(--fg-1)' }}>{v}</span>
                      <span style={{ color: 'var(--fg-3)' }}>→</span>
                      <span style={{ color: 'var(--fg-3)' }}>closure</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* inspector */}
            <StepInspector step={selected}/>
          </>
        ) : (
          <SourceView/>
        )}
      </div>
    </div>
  );
}

function DraggableStep({ step, index, active, isDragging, isOver, onClick, onDragStart, onDragEnter, onDrop, onDragEnd }) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', marginBottom: 3,
        background: active ? 'var(--bg-3)' : 'var(--bg-1)',
        border: `1px solid ${active ? 'var(--ac-bd)' : 'var(--bd-1)'}`,
        borderRadius: 4, cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        borderTop: isOver ? '2px solid var(--ac)' : `1px solid ${active ? 'var(--ac-bd)' : 'var(--bd-1)'}`,
      }}>
      <svg width="8" height="14" viewBox="0 0 8 14" style={{ flexShrink: 0 }}>
        {[0, 4, 8, 12].map(y => (
          <g key={y}>
            <circle cx="2" cy={y + 1} r="0.8" fill="var(--fg-3)"/>
            <circle cx="6" cy={y + 1} r="0.8" fill="var(--fg-3)"/>
          </g>
        ))}
      </svg>
      <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', width: 14 }}>{String(index + 1).padStart(2, '0')}</span>
      <MethodBadge method={step.method}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.name}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.url}</div>
      </div>
      {step.extract && <div title="Extracts variable" style={{ color: 'var(--ac)' }}><IconTrail size={11}/></div>}
    </div>
  );
}

function StepInspector({ step }) {
  const [tab, setTab] = uSe('config');
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 18px 10px', borderBottom: '1px solid var(--bd-1)' }}>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Step {step.id}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input defaultValue={step.name} style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-0)', flex: 1 }}/>
          <button style={{ fontSize: 11, color: 'var(--fg-2)', padding: '4px 8px', border: '1px solid var(--bd-2)', borderRadius: 3 }}>Duplicate</button>
          <button style={{ fontSize: 11, color: 'var(--err)', padding: '4px 8px', border: '1px solid var(--bd-2)', borderRadius: 3 }}>Delete</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <MethodBadge method={step.method} size="lg"/>
          <input defaultValue={step.url} className="mono" style={{ flex: 1, fontSize: 12, padding: '6px 10px', border: '1px solid var(--bd-2)', borderRadius: 4, background: 'var(--bg-0)' }}/>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd-1)', padding: '0 14px' }}>
        {['config', 'assertions', 'extract', 'hooks'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 12px', fontSize: 12,
            color: tab === t ? 'var(--fg-0)' : 'var(--fg-2)',
            borderBottom: tab === t ? '2px solid var(--ac)' : '2px solid transparent',
            marginBottom: -1, textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
        {tab === 'config' && <ConfigTab step={step}/>}
        {tab === 'assertions' && <AssertionsTab/>}
        {tab === 'extract' && <ExtractTab step={step}/>}
        {tab === 'hooks' && <HooksTab/>}
      </div>
    </div>
  );
}

function ConfigTab({ step }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Body</div>
        <pre className="mono" style={{ margin: 0, padding: '12px 14px', background: 'var(--bg-0)', border: '1px solid var(--bd-1)', borderRadius: 4, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-1)' }}>
          {step.requestBody ? <JsonPretty text={JSON.stringify(step.requestBody, null, 2)}/> : <span style={{ color: 'var(--fg-3)' }}>no body</span>}
        </pre>
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Headers · inherited + overrides</div>
        <div style={{ border: '1px solid var(--bd-1)', borderRadius: 4, overflow: 'hidden' }}>
          {[
            ['Authorization',  'Bearer {{env.TOKEN}}',       'inherited'],
            ['Idempotency-Key','{{crypto.uuid()}}',          'inherited'],
            ['X-Step-Id',      'checkout.{{step.index}}',    'override'],
          ].map(([k, v, src]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px', gap: 10, padding: '6px 12px', fontSize: 12, borderBottom: '1px solid var(--bd-1)' }} className="mono">
              <span style={{ color: 'var(--info)' }}>{k}</span>
              <span style={{ color: 'var(--fg-1)' }}>{v}</span>
              <span style={{ fontSize: 10, color: src === 'override' ? 'var(--ac)' : 'var(--fg-3)', textAlign: 'right' }}>{src}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssertionsTab() {
  const list = [
    { ok: true,  path: 'res.status',                        op: 'equals',     value: '201' },
    { ok: true,  path: 'res.data.status',                   op: 'equals',     value: '"requires_capture"' },
    { ok: true,  path: 'res.data.amount',                   op: 'equals',     value: '12900' },
    { ok: true,  path: 'res.timing.ttfb',                   op: 'lessThan',   value: '500' },
  ];
  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ border: '1px solid var(--bd-1)', borderRadius: 4, overflow: 'hidden' }}>
        {list.map((a, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '16px 1fr 90px 1fr 20px', gap: 10, padding: '8px 12px', alignItems: 'center', borderBottom: i < list.length - 1 ? '1px solid var(--bd-1)' : 'none', fontSize: 12 }} className="mono">
            <IconCheck size={11} style={{ color: 'var(--ok)' }}/>
            <span style={{ color: 'var(--fg-0)' }}>{a.path}</span>
            <span style={{ color: 'var(--info)' }}>{a.op}</span>
            <span style={{ color: 'var(--ac)' }}>{a.value}</span>
            <button style={{ color: 'var(--fg-3)' }}><IconX size={10}/></button>
          </div>
        ))}
      </div>
      <button style={{ marginTop: 8, fontSize: 12, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <IconPlus size={11}/> Add assertion
      </button>
    </div>
  );
}

function ExtractTab({ step }) {
  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 10 }}>
        Extracts bind to the journey closure and are available to later steps as <span className="mono" style={{ color: 'var(--ac)' }}>{`{{name}}`}</span>.
      </div>
      <div style={{ border: '1px solid var(--bd-1)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 100px', gap: 10, padding: '6px 12px', fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--bd-1)' }}>
          <span>Variable</span><span>From JSONPath</span><span>Scope</span>
        </div>
        {step.extract ? (
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 100px', gap: 10, padding: '8px 12px', fontSize: 12 }} className="mono">
            <span style={{ color: 'var(--ac)' }}>{step.extract.split('=')[0].trim()}</span>
            <span style={{ color: 'var(--fg-1)' }}>{step.extract.split('=')[1]?.trim()}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>journey</span>
          </div>
        ) : (
          <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--fg-3)' }}>No extractions from this step.</div>
        )}
      </div>
      <button style={{ marginTop: 8, fontSize: 12, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <IconPlus size={11}/> Add extraction
      </button>
    </div>
  );
}

function HooksTab() {
  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 12, height: '100%', maxHeight: 440 }}>
      <HookEditor title="before()" code={`// runs before the request\nctx.headers.set('X-Trace', crypto.uuid());`}/>
      <HookEditor title="after()" code={`// runs after the response\nif (res.status === 201) {\n  console.log('payment authorized');\n}`}/>
    </div>
  );
}
function HookEditor({ title, code }) {
  return (
    <div style={{ border: '1px solid var(--bd-1)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-0)' }}>
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--bd-1)', fontSize: 11 }} className="mono">
        <span style={{ color: 'var(--m-patch)' }}>{title}</span>
      </div>
      <pre className="mono" style={{ margin: 0, padding: '10px 14px', flex: 1, overflow: 'auto', fontSize: 12, lineHeight: 1.6, color: 'var(--fg-1)' }}>{code}</pre>
    </div>
  );
}

function SourceView() {
  const source = `import { journey, step } from '@journey/core';
import { endpoints } from '@/generated/endpoints';

export default journey('checkout-happy-path', { tags: ['smoke', 'payments'] }, async (ctx) => {
  const { accountId } = await step('Open customer account',
    endpoints.postAccounts({ type: 'individual', email: 'ada@example.dev', currency: 'USD' }),
    { extract: (res) => ({ accountId: res.data.id }) }
  );

  const { transferId } = await step('Fund account (test mode)',
    endpoints.postTransfers({ destination: accountId, amount: 50000, currency: 'USD', source: 'test_pool' }),
    { extract: (res) => ({ transferId: res.data.id }) }
  );

  const { paymentId } = await step('Authorize payment',
    endpoints.postPayments({ account: accountId, amount: 12900, currency: 'USD', capture: false, payment_method: 'pm_card_visa' }),
    { extract: (res) => ({ paymentId: res.data.id }) }
  );

  await step('Capture payment',
    endpoints.capturePayment(paymentId, { amount_to_capture: 12900 }),
    { assert: (res) => res.data.status === 'succeeded' }
  );

  await step('Verify balance',
    endpoints.getAccountBalance(accountId),
  );

  await step('Assert receipt webhook fired',
    endpoints.listEvents({ type: 'payment.succeeded', related: paymentId }),
    { assert: (res) => res.data.data.length >= 1 }
  );
});`;
  const lines = source.split('\n');
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-0)' }}>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', fontSize: 12 }} className="mono">
        <div style={{
          padding: '14px 10px 14px 14px', textAlign: 'right', color: 'var(--fg-3)',
          borderRight: '1px solid var(--bd-1)', userSelect: 'none', minWidth: 40,
        }}>
          {lines.map((_, i) => <div key={i} style={{ lineHeight: 1.7 }}>{i + 1}</div>)}
        </div>
        <pre style={{ margin: 0, padding: '14px 18px', lineHeight: 1.7, color: 'var(--fg-1)', flex: 1 }}>
          <TsHighlight text={source}/>
        </pre>
      </div>
      <div style={{ padding: '6px 14px', borderTop: '1px solid var(--bd-1)', fontSize: 10, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 12 }} className="mono">
        <span>TypeScript</span>
        <span>·</span>
        <span>UTF-8</span>
        <span>·</span>
        <span>LF</span>
        <div style={{ flex: 1 }}/>
        <span>Ln 14, Col 22</span>
      </div>
    </div>
  );
}

function TsHighlight({ text }) {
  const keywords = new Set(['import', 'from', 'export', 'default', 'const', 'async', 'await', 'return', 'if', 'else']);
  const tokens = [];
  let i = 0;
  const push = (t, color) => tokens.push(<span key={tokens.length} style={{ color }}>{t}</span>);
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== "'") j++;
      push(text.slice(i, j + 1), 'var(--ok)');
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') j++;
      push(text.slice(i, j), 'var(--fg-3)');
      i = j;
    } else if (/[a-zA-Z_$]/.test(c)) {
      let j = i;
      while (j < text.length && /[a-zA-Z0-9_$]/.test(text[j])) j++;
      const w = text.slice(i, j);
      if (keywords.has(w)) push(w, 'var(--m-patch)');
      else if (['journey', 'step', 'endpoints', 'ctx', 'res'].includes(w)) push(w, 'var(--ac)');
      else if (w === 'true' || w === 'false') push(w, 'var(--m-patch)');
      else if (/^[A-Z]/.test(w)) push(w, 'var(--info)');
      else push(w, 'var(--fg-1)');
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      push(text.slice(i, j), 'var(--ac)');
      i = j;
    } else {
      push(c, 'var(--fg-2)');
      i++;
    }
  }
  return <>{tokens}</>;
}

// ─────────────────────────────── FILES ───────────────────────────────

function PageFiles() {
  const [expanded, setExpanded] = uSe({ journeys: true, environments: true, generated: true, '.journey': false });
  const [selected, setSelected] = uSe('journeys/checkout-happy-path.journey.ts');

  const tree = [
    { type: 'file',   path: 'journey.config.json',                 size: '412 B',  tag: null },
    { type: 'file',   path: 'openapi.yaml',                        size: '28.4 KB', tag: 'source' },
    { type: 'dir',    path: 'generated',                           locked: true, children: [
      { type: 'file', path: 'generated/endpoints.ts',              size: '18.1 KB', tag: 'generated' },
      { type: 'file', path: 'generated/models.ts',                 size: '9.2 KB',  tag: 'generated' },
    ]},
    { type: 'dir',    path: 'journeys',                            children: [
      { type: 'file', path: 'journeys/checkout-happy-path.journey.ts', size: '1.6 KB', modified: true },
      { type: 'file', path: 'journeys/refund-partial.journey.ts',      size: '1.1 KB' },
      { type: 'file', path: 'journeys/3ds-challenge.journey.ts',       size: '2.3 KB' },
      { type: 'file', path: 'journeys/webhook-delivery-retry.journey.ts', size: '1.8 KB' },
      { type: 'file', path: 'journeys/transfer-insufficient-funds.journey.ts', size: '940 B' },
      { type: 'file', path: 'journeys/dispute-evidence-upload.journey.ts',     size: '2.1 KB' },
    ]},
    { type: 'dir',    path: 'environments',                        children: [
      { type: 'file', path: 'environments/local.json',             size: '310 B' },
      { type: 'file', path: 'environments/staging.json',           size: '422 B' },
      { type: 'file', path: 'environments/ci.json',                size: '280 B' },
    ]},
    { type: 'dir',    path: '.journey', hidden: true, children: [
      { type: 'dir',  path: '.journey/cache', children: [
        { type: 'file', path: '.journey/cache/runs.db',            size: '1.2 MB', tag: 'gitignored' },
      ]}
    ]},
  ];

  const renderNode = (n, depth = 0) => {
    const name = n.path.split('/').pop();
    if (n.type === 'dir') {
      const open = expanded[name] || false;
      return (
        <React.Fragment key={n.path}>
          <button onClick={() => setExpanded(s => ({ ...s, [name]: !s[name] }))} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 6,
            padding: `4px 10px 4px ${10 + depth * 14}px`, textAlign: 'left', fontSize: 12,
            opacity: n.hidden ? 0.55 : 1,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <IconChevron size={9} style={{ color: 'var(--fg-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}/>
            <IconFolder size={13} style={{ color: n.locked ? 'var(--fg-3)' : 'var(--ac)' }}/>
            <span className="mono" style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{name}/</span>
            {n.locked && <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 4 }} className="mono">generated — don't edit</span>}
          </button>
          {open && n.children.map(c => renderNode(c, depth + 1))}
        </React.Fragment>
      );
    }
    const active = selected === n.path;
    const isGen = n.tag === 'generated';
    return (
      <button key={n.path} onClick={() => setSelected(n.path)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6,
        padding: `4px 10px 4px ${22 + depth * 14}px`, textAlign: 'left', fontSize: 12,
        background: active ? 'var(--bg-3)' : 'transparent',
        borderLeft: active ? '2px solid var(--ac)' : '2px solid transparent',
        opacity: isGen ? 0.65 : 1,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-1)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
        <IconFiles size={12} style={{ color: 'var(--fg-3)' }}/>
        <span className="mono" style={{ color: active ? 'var(--fg-0)' : 'var(--fg-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {n.modified && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ac)' }}/>}
        {n.tag === 'gitignored' && <span style={{ fontSize: 9, color: 'var(--fg-3)' }} className="mono">gitignored</span>}
        {n.tag === 'source' && <span style={{ fontSize: 9, color: 'var(--info)' }} className="mono">source</span>}
        <span style={{ fontSize: 10, color: 'var(--fg-3)' }} className="mono">{n.size}</span>
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{ width: 360, borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}>
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--bd-1)' }}>
          <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Project tree</span>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 10, color: 'var(--fg-3)' }} className="mono">~/work/ledger/api</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
          {tree.map(n => renderNode(n))}
        </div>
      </div>

      <FilePreview path={selected}/>
    </div>
  );
}

function FilePreview({ path }) {
  const isGenerated = path.startsWith('generated/');
  const isJson = path.endsWith('.json') || path.endsWith('.yaml');
  const snippets = {
    'journeys/checkout-happy-path.journey.ts': `import { journey, step } from '@journey/core';
import { endpoints } from '@/generated/endpoints';

export default journey('checkout-happy-path', {
  tags: ['smoke', 'payments']
}, async (ctx) => {
  const { accountId } = await step('Open customer account',
    endpoints.postAccounts({ ... })
  );
  // 5 more steps
});`,
    'journey.config.json': `{
  "name": "ledger-api",
  "baseUrl": "{{env.BASE_URL}}",
  "defaultEnv": "local",
  "paths": {
    "openapi": "./openapi.yaml",
    "journeys": "./journeys",
    "environments": "./environments"
  }
}`,
  };
  const content = snippets[path] || `// ${path}\n// Preview stub for this file.`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--bd-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconFiles size={13} style={{ color: 'var(--fg-2)' }}/>
        <span className="mono" style={{ fontSize: 13 }}>{path}</span>
        {isGenerated && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 3, fontSize: 10 }} className="mono">
            <IconX size={10}/> read-only · regenerated by <span style={{ color: 'var(--ac)' }}>journey generate</span>
          </div>
        )}
        <div style={{ flex: 1 }}/>
        <button style={{ padding: '4px 10px', border: '1px solid var(--bd-2)', borderRadius: 4, fontSize: 11, color: 'var(--fg-1)' }}>
          Open in editor
        </button>
      </div>
      <pre className="mono" style={{ margin: 0, padding: '14px 18px', fontSize: 12, lineHeight: 1.7, color: 'var(--fg-1)', flex: 1, overflow: 'auto' }}>
        {isJson ? <JsonPretty text={content}/> : <TsHighlight text={content}/>}
      </pre>
    </div>
  );
}

// ─────────────────────────────── ENVIRONMENTS ───────────────────────────────

function PageEnvironments() {
  const [selected, setSelected] = uSe('local');
  const [jsonView, setJsonView] = uSe(false);
  const [revealed, setRevealed] = uSe({});

  const envVars = {
    local: [
      { key: 'BASE_URL',      value: 'http://api.ledger.test:4000', secret: false, source: 'explicit' },
      { key: 'TOKEN',         value: 'sk_test_51HkQe2Yq2A4vNp3L', secret: true,  source: 'explicit' },
      { key: 'SECRET',        value: 'whsec_5c8df117e94d22b',      secret: true,  source: 'explicit' },
      { key: 'API_KEY',       value: 'ak_test_2dr4k',              secret: true,  source: '.env.local' },
      { key: 'MERCHANT_ID',   value: 'mer_default',                secret: false, source: 'explicit' },
      { key: 'CURRENCY',      value: 'USD',                        secret: false, source: 'explicit' },
    ],
    staging: [
      { key: 'BASE_URL',      value: 'https://api.staging.ledger.co', secret: false, source: 'explicit' },
      { key: 'TOKEN',         value: 'sk_stg_91jM2AzB8FvE7qN2',    secret: true,  source: 'explicit' },
      { key: 'SECRET',        value: 'whsec_9a2e8cf7a1bd',         secret: true,  source: 'explicit' },
      { key: 'API_KEY',       value: 'ak_stg_9fKp2',               secret: true,  source: '1password' },
      { key: 'MERCHANT_ID',   value: 'mer_stg_primary',            secret: false, source: 'explicit' },
      { key: 'CURRENCY',      value: 'USD',                        secret: false, source: 'explicit' },
      { key: 'WEBHOOK_URL',   value: 'https://hooks.ledger.co/stg',secret: false, source: 'explicit' },
      { key: 'RETRY_COUNT',   value: '3',                          secret: false, source: 'explicit' },
      { key: 'TIMEOUT_MS',    value: '5000',                       secret: false, source: 'explicit' },
    ],
    ci: [
      { key: 'BASE_URL',      value: 'http://mock:4000',           secret: false, source: 'explicit' },
      { key: 'TOKEN',         value: '$JRN_CI_TOKEN',              secret: true,  source: 'github actions' },
      { key: 'SECRET',        value: '$JRN_CI_SECRET',             secret: true,  source: 'github actions' },
      { key: 'MERCHANT_ID',   value: 'mer_ci',                     secret: false, source: 'explicit' },
      { key: 'CURRENCY',      value: 'USD',                        secret: false, source: 'explicit' },
    ],
  };

  const activeVars = envVars[selected];

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* env sidebar */}
      <div style={{ width: 220, borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}>
        <div style={{ padding: '10px 14px', fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--bd-1)' }}>Environments</div>
        <div style={{ flex: 1, padding: '6px 6px' }}>
          {LEDGER_ENVS.map(e => (
            <button key={e.name} onClick={() => setSelected(e.name)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 4, fontSize: 12,
              background: selected === e.name ? 'var(--bg-3)' : 'transparent',
              borderLeft: selected === e.name ? '2px solid var(--ac)' : '2px solid transparent',
              textAlign: 'left',
            }}
            onMouseEnter={ev => { if (selected !== e.name) ev.currentTarget.style.background = 'var(--bg-1)'; }}
            onMouseLeave={ev => { if (selected !== e.name) ev.currentTarget.style.background = 'transparent'; }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: e.active ? 'var(--ac)' : 'var(--fg-3)' }}/>
              <span className="mono" style={{ flex: 1, color: 'var(--fg-0)' }}>{e.name}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{envVars[e.name].length}</span>
            </button>
          ))}
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 10px', marginTop: 6, fontSize: 12, color: 'var(--fg-2)',
            border: '1px dashed var(--bd-2)', borderRadius: 4,
          }}>
            <IconPlus size={11}/> New environment
          </button>
        </div>
      </div>

      {/* env detail */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--bd-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }} className="mono">{selected}</h2>
              {selected === 'local' && <span style={{ fontSize: 10, color: 'var(--ac)', background: 'var(--ac-bg)', padding: '1px 6px', borderRadius: 2 }} className="mono">active</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }} className="mono">environments/{selected}.json · {activeVars.length} variables</div>
          </div>

          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-2)', padding: 2, borderRadius: 4 }}>
            <button onClick={() => setJsonView(false)} style={{
              padding: '4px 10px', fontSize: 11, borderRadius: 3,
              background: !jsonView ? 'var(--bg-0)' : 'transparent',
              color: !jsonView ? 'var(--fg-0)' : 'var(--fg-2)',
              border: !jsonView ? '1px solid var(--bd-2)' : '1px solid transparent',
            }}>Table</button>
            <button onClick={() => setJsonView(true)} style={{
              padding: '4px 10px', fontSize: 11, borderRadius: 3,
              background: jsonView ? 'var(--bg-0)' : 'transparent',
              color: jsonView ? 'var(--fg-0)' : 'var(--fg-2)',
              border: jsonView ? '1px solid var(--bd-2)' : '1px solid transparent',
            }} className="mono">JSON</button>
          </div>
          {selected !== 'local' && (
            <button style={{ padding: '5px 12px', border: '1px solid var(--bd-2)', borderRadius: 4, fontSize: 11, color: 'var(--fg-1)' }}>
              Activate
            </button>
          )}
        </div>

        {!jsonView ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '14px 200px 1fr 140px 30px 20px', gap: 10, padding: '8px 20px', fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--bd-1)' }}>
              <span></span><span>Key</span><span>Value</span><span>Source</span><span></span><span></span>
            </div>
            {activeVars.map((v, i) => (
              <div key={v.key} style={{ display: 'grid', gridTemplateColumns: '14px 200px 1fr 140px 30px 20px', gap: 10, padding: '7px 20px', alignItems: 'center', borderBottom: '1px solid var(--bd-1)', fontSize: 12 }} className="mono">
                <Checkbox checked={true} onChange={() => {}}/>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ color: 'var(--info)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.key}</span>
                  {v.secret && <IconTrail size={10} style={{ color: 'var(--warn)', flexShrink: 0 }} title="secret"/>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {v.secret && !revealed[v.key] ? (
                    <span style={{ color: 'var(--fg-2)', letterSpacing: '0.1em' }}>••••••••••••••••</span>
                  ) : (
                    <span style={{ color: v.value.startsWith('$') ? 'var(--m-patch)' : 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.value}</span>
                  )}
                  {v.secret && (
                    <button onClick={() => setRevealed(r => ({ ...r, [v.key]: !r[v.key] }))} style={{ color: 'var(--fg-3)', flexShrink: 0 }}>
                      {revealed[v.key] ? <IconEyeOff size={12}/> : <IconEye size={12}/>}
                    </button>
                  )}
                </div>
                <span style={{ fontSize: 10, color: v.source === 'explicit' ? 'var(--fg-3)' : 'var(--ac)' }}>{v.source}</span>
                <button style={{ color: 'var(--fg-3)' }}><IconCopy size={11}/></button>
                <button style={{ color: 'var(--fg-3)' }}><IconX size={10}/></button>
              </div>
            ))}
            <button style={{ padding: '10px 20px', fontSize: 12, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconPlus size={11}/> Add variable
            </button>
          </div>
        ) : (
          <pre className="mono" style={{ margin: 0, padding: '16px 22px', fontSize: 12, lineHeight: 1.7, color: 'var(--fg-1)', flex: 1, overflow: 'auto', background: 'var(--bg-0)' }}>
            <JsonPretty text={JSON.stringify(activeVars.reduce((a, v) => { a[v.key] = v.secret ? '•••••' : v.value; return a; }, {}), null, 2)}/>
          </pre>
        )}

        <div style={{ padding: '8px 20px', borderTop: '1px solid var(--bd-1)', fontSize: 11, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 12 }} className="mono">
          <IconGit size={11}/>
          <span>Secrets redacted in VCS via <span style={{ color: 'var(--ac)' }}>.gitattributes</span></span>
          <div style={{ flex: 1 }}/>
          <span>last saved 4m ago</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PageEditor, PageFiles, PageEnvironments });
