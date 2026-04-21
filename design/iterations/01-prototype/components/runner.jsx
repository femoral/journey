// Journey — Runner page (list + detail + step cards + history diff)
const { useState: uSr, useMemo: uMr } = React;

function PageJourneys({ onRunJourney, onOpenConsole }) {
  const [selectedId, setSelectedId] = uSr('j_checkout');
  const [runState, setRunState] = uSr('idle'); // idle | running | done
  const [currentStep, setCurrentStep] = uSr(-1);
  const [filter, setFilter] = uSr('');

  const selected = LEDGER_JOURNEYS.find(j => j.id === selectedId);

  const runNow = () => {
    setRunState('running');
    setCurrentStep(0);
    onOpenConsole?.();
    let i = 0;
    const tick = () => {
      i++;
      if (i < CHECKOUT_STEPS.length) {
        setCurrentStep(i);
        setTimeout(tick, 550);
      } else {
        setRunState('done');
        setCurrentStep(CHECKOUT_STEPS.length - 1);
      }
    };
    setTimeout(tick, 550);
  };

  const filtered = LEDGER_JOURNEYS.filter(j => !filter || j.name.includes(filter.toLowerCase()));

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* journey list */}
      <div style={{ width: 300, borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}>
        <div style={{ padding: '10px 10px 8px', display: 'flex', gap: 6, borderBottom: '1px solid var(--bd-1)' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', border: '1px solid var(--bd-1)', borderRadius: 4, padding: '5px 8px' }}>
            <IconSearch size={12} style={{ color: 'var(--fg-3)' }}/>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter…" style={{ flex: 1, fontSize: 12 }}/>
          </div>
          <button style={{ padding: '0 8px', border: '1px solid var(--bd-2)', borderRadius: 4, color: 'var(--fg-2)' }}><IconPlus size={12}/></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filtered.map(j => (
            <JourneyRow key={j.id} journey={j} active={j.id === selectedId} onClick={() => setSelectedId(j.id)}/>
          ))}
        </div>
      </div>

      {/* detail */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <JourneyDetailHeader journey={selected} runState={runState} onRun={runNow}/>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 0, minHeight: '100%' }}>
            <StepTimeline runState={runState} currentStep={currentStep}/>
            <RunHistoryPanel/>
          </div>
        </div>
      </div>
    </div>
  );
}

function JourneyRow({ journey, active, onClick }) {
  const r = journey.lastRun;
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', flexDirection: 'column', gap: 4,
      padding: '10px 14px', textAlign: 'left',
      background: active ? 'var(--bg-3)' : 'transparent',
      borderLeft: active ? '2px solid var(--ac)' : '2px solid transparent',
      borderBottom: '1px solid var(--bd-1)',
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-1)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <RunDot state={r?.status || 'idle'}/>
        <span className="mono" style={{ flex: 1, fontSize: 13, color: 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{journey.name}</span>
        <span style={{ fontSize: 10, color: 'var(--fg-3)' }} className="mono">{r?.ago || '—'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--fg-3)' }} className="mono">
        <span>{journey.steps} steps</span>
        {r && <><span>·</span><span>{r.ms}ms</span></>}
        <span style={{ flex: 1 }}/>
        {journey.tags.map(t => (
          <span key={t} style={{ border: '1px solid var(--bd-2)', padding: '0 4px', borderRadius: 2, color: 'var(--fg-2)' }}>{t}</span>
        ))}
      </div>
    </button>
  );
}

function JourneyDetailHeader({ journey, runState, onRun }) {
  return (
    <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--bd-1)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} className="mono">{journey.name}</h2>
            {journey.tags.map(t => (
              <span key={t} style={{ fontSize: 10, border: '1px solid var(--bd-2)', padding: '1px 5px', borderRadius: 2, color: 'var(--fg-2)' }} className="mono">{t}</span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="mono">{journey.file} · {journey.steps} steps</div>
        </div>
        <button style={BTN_GHOST} title="Diff last run"><IconDiff size={12}/></button>
        <button style={BTN_GHOST} title="Open in editor"><IconEditor size={12}/></button>
        <button onClick={onRun} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
          background: runState === 'running' ? 'var(--bg-2)' : 'var(--ac)',
          color: runState === 'running' ? 'var(--fg-0)' : '#1a1200',
          borderRadius: 5, fontWeight: 600, fontSize: 12, border: runState === 'running' ? '1px solid var(--bd-2)' : 'none',
        }}>
          {runState === 'running' ? <><IconStop size={10}/> Stop</> : <><IconPlay size={10}/> Run journey</>}
        </button>
      </div>
    </div>
  );
}

const BTN_GHOST = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
  border: '1px solid var(--bd-2)', borderRadius: 4, fontSize: 12, color: 'var(--fg-1)',
};

function StepTimeline({ runState, currentStep }) {
  const [expandedId, setExpandedId] = uSr('s3');

  const stepState = (i) => {
    if (runState === 'idle') return CHECKOUT_STEPS[i].state;
    if (i < currentStep) return 'pass';
    if (i === currentStep && runState === 'running') return 'running';
    if (i > currentStep && runState === 'running') return 'pending';
    if (runState === 'done') return 'pass';
    return CHECKOUT_STEPS[i].state;
  };

  return (
    <div style={{ padding: '14px 20px', borderRight: '1px solid var(--bd-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontSize: 11, color: 'var(--fg-2)' }}>
        <span className="mono" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)' }}>Current run</span>
        {runState === 'running' && (
          <>
            <span style={{ flex: 1, height: 2, background: 'var(--bd-1)', borderRadius: 1, overflow: 'hidden' }}>
              <div style={{ width: `${((currentStep + 1) / CHECKOUT_STEPS.length) * 100}%`, height: '100%', background: 'var(--ac)', transition: 'width 0.4s' }}/>
            </span>
            <span className="mono" style={{ color: 'var(--ac)' }}>{currentStep + 1}/{CHECKOUT_STEPS.length}</span>
          </>
        )}
        {runState !== 'running' && (
          <>
            <span className="mono">just now · 842ms</span>
            <span style={{ flex: 1 }}/>
            <IconClock size={11}/>
            <span className="mono">local</span>
          </>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        {/* connector line */}
        <div style={{ position: 'absolute', left: 11, top: 14, bottom: 14, width: 1, background: 'var(--bd-2)' }}/>
        {CHECKOUT_STEPS.map((s, i) => (
          <StepCard
            key={s.id}
            step={s}
            index={i}
            state={stepState(i)}
            expanded={expandedId === s.id}
            onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StepCard({ step, index, state, expanded, onToggle }) {
  const iconFor = () => {
    if (state === 'pass')    return <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-0)', border: '1.5px solid var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ok)' }}><IconCheck size={11}/></div>;
    if (state === 'fail')    return <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-0)', border: '1.5px solid var(--err)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--err)' }}><IconX size={11}/></div>;
    if (state === 'running') return <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-0)', border: '1.5px solid var(--ac)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px var(--ac-bg)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ac)', animation: 'pulse 1s infinite' }}/></div>;
    return <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-0)', border: '1.5px solid var(--bd-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontSize: 10 }} className="mono">{index + 1}</div>;
  };

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 8, position: 'relative' }}>
      <div style={{ paddingTop: 4, zIndex: 1 }}>{iconFor()}</div>
      <div style={{ flex: 1, border: '1px solid var(--bd-1)', borderRadius: 5, background: 'var(--bg-1)', overflow: 'hidden' }}>
        <button onClick={onToggle} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', textAlign: 'left',
        }}>
          <MethodBadge method={step.method}/>
          <span className="mono" style={{ fontSize: 12, color: 'var(--fg-0)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.url}</span>
          {state !== 'pending' && state !== 'running' && <StatusPill status={step.status}/>}
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)', width: 50, textAlign: 'right' }}>{state === 'pending' ? '—' : state === 'running' ? '…' : `${step.ms}ms`}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', width: 50, textAlign: 'right' }}>{state === 'pending' ? '' : step.size}</span>
          <IconChevron size={11} style={{ color: 'var(--fg-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}/>
        </button>
        {expanded && state !== 'pending' && state !== 'running' && (
          <StepDetail step={step}/>
        )}
      </div>
    </div>
  );
}

function StepDetail({ step }) {
  const [tab, setTab] = uSr('request');
  return (
    <div style={{ borderTop: '1px solid var(--bd-1)', background: 'var(--bg-0)' }}>
      <div style={{ padding: '2px 12px 0', display: 'flex', alignItems: 'center', gap: 0, borderBottom: '1px solid var(--bd-1)' }}>
        <MiniTab label="Request" active={tab === 'request'} onClick={() => setTab('request')}/>
        <MiniTab label="Response" active={tab === 'response'} onClick={() => setTab('response')}/>
        <MiniTab label="Extract" active={tab === 'extract'} onClick={() => setTab('extract')} count={step.extract ? 1 : null}/>
        <MiniTab label="Logs" active={tab === 'logs'} onClick={() => setTab('logs')} count={step.logs.length || null}/>
        <div style={{ flex: 1 }}/>
        <button style={{ padding: '4px 8px', fontSize: 11, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconCopy size={10}/> curl
        </button>
        <button style={{ padding: '4px 8px', fontSize: 11, color: 'var(--ac)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconPlay size={10}/> Run only
        </button>
        <button style={{ padding: '4px 8px', fontSize: 11, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconEndpoints size={10}/> Open in endpoints
        </button>
      </div>
      <div style={{ padding: '10px 14px' }}>
        {tab === 'request' && (
          <>
            {step.requestBody ? (
              <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-1)' }}>
                <JsonPretty text={JSON.stringify(step.requestBody, null, 2)}/>
              </pre>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No request body</div>
            )}
          </>
        )}
        {tab === 'response' && (
          <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-1)' }}>
            <JsonPretty text={JSON.stringify(step.responseBody, null, 2)}/>
          </pre>
        )}
        {tab === 'extract' && (
          step.extract
            ? <pre className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--ac)' }}>{step.extract}</pre>
            : <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No extractions</div>
        )}
        {tab === 'logs' && (
          step.logs.length
            ? step.logs.map((l, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--fg-1)', padding: '3px 0', display: 'flex', gap: 8 }} className="mono">
                <span style={{ color: 'var(--fg-3)' }}>console.log</span>
                <span>{l.text}</span>
              </div>
            ))
            : <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No logs from this step</div>
        )}
      </div>
    </div>
  );
}

function MiniTab({ label, active, onClick, count }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 12px', fontSize: 11,
      color: active ? 'var(--fg-0)' : 'var(--fg-2)',
      borderBottom: active ? '2px solid var(--ac)' : '2px solid transparent',
      marginBottom: -1,
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      {label}
      {count != null && <span className="mono" style={{ fontSize: 9, color: 'var(--fg-3)' }}>{count}</span>}
    </button>
  );
}

function RunHistoryPanel() {
  const runs = [
    { status: 'pass', ms: 842, ago: '2m',  env: 'local',   commit: 'a1b2c3d', delta: null },
    { status: 'pass', ms: 798, ago: '2h',  env: 'staging', commit: '7f2e1aa', delta: -44 },
    { status: 'pass', ms: 811, ago: '1d',  env: 'ci',      commit: 'e94d22b', delta: -13 },
    { status: 'fail', ms: 432, ago: '2d',  env: 'staging', commit: '9aa21ff', delta: null },
    { status: 'pass', ms: 1021, ago: '3d', env: 'ci',      commit: '3c8df11', delta: 210 },
    { status: 'pass', ms: 822,  ago: '4d', env: 'local',   commit: '3c8df11', delta: -199 },
    { status: 'pass', ms: 1032, ago: '5d', env: 'ci',      commit: 'd229abc', delta: null },
  ];
  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>History</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {runs.map((r, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '10px 1fr 54px 30px',
              alignItems: 'center', gap: 8,
              padding: '6px 2px', fontSize: 11,
              borderTop: i === 0 ? 'none' : '1px solid var(--bd-1)',
            }}>
              <RunDot state={r.status} size={6}/>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="mono" style={{ color: 'var(--fg-1)' }}>{r.ago} · {r.commit}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{r.env}</span>
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)', textAlign: 'right' }}>{r.ms}ms</span>
              <span className="mono" style={{ fontSize: 10, color: r.delta == null ? 'var(--fg-3)' : r.delta > 0 ? 'var(--err)' : 'var(--ok)', textAlign: 'right' }}>
                {r.delta == null ? '—' : (r.delta > 0 ? '+' : '') + r.delta}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ values }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const w = 240, h = 40;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
    return [x, y];
  });
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path + ` L${w} ${h} L0 ${h} Z`} fill="var(--ac-bg)"/>
      <path d={path} stroke="var(--ac)" strokeWidth="1.5" fill="none"/>
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="var(--ac)"/>)}
    </svg>
  );
}

Object.assign(window, { PageJourneys });
