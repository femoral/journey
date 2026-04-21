// Journey — App shell: sidebar, top bar, project switcher
const { useState, useEffect, useRef, useMemo, useCallback } = React;

function MethodBadge({ method, size = 'sm' }) {
  const colorMap = {
    GET: 'var(--m-get)', POST: 'var(--m-post)', PUT: 'var(--m-put)',
    PATCH: 'var(--m-patch)', DELETE: 'var(--m-del)',
  };
  const display = method === 'DELETE' ? 'DEL' : method;
  return (
    <span className="mono" style={{
      color: colorMap[method] || 'var(--fg-2)',
      fontWeight: 600,
      fontSize: size === 'sm' ? 10 : 11,
      letterSpacing: '0.04em',
      minWidth: size === 'sm' ? 30 : 38,
      display: 'inline-block',
      textAlign: 'left',
    }}>{display}</span>
  );
}

function StatusPill({ status }) {
  let color = 'var(--fg-2)', bg = 'transparent';
  if (status >= 200 && status < 300) { color = 'var(--ok)'; bg = 'var(--ok-bg)'; }
  else if (status >= 300 && status < 400) { color = 'var(--warn)'; bg = 'var(--warn-bg)'; }
  else if (status >= 400 && status < 500) { color = 'var(--warn)'; bg = 'var(--warn-bg)'; }
  else if (status >= 500) { color = 'var(--err)'; bg = 'var(--err-bg)'; }
  return (
    <span className="mono" style={{
      color, background: bg, padding: '1px 6px', borderRadius: 3,
      fontSize: 11, fontWeight: 600,
    }}>{status}</span>
  );
}

function RunDot({ state, size = 8 }) {
  const c = state === 'pass' ? 'var(--ok)'
    : state === 'fail' ? 'var(--err)'
    : state === 'running' ? 'var(--ac)'
    : 'var(--fg-3)';
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: c,
      boxShadow: state === 'running' ? `0 0 0 3px ${c}22` : 'none',
      flexShrink: 0,
      display: 'inline-block',
    }}/>
  );
}

function TopBar({ project, onOpenSwitcher, onToggleConsole, consoleOpen, onOpenTweaks }) {
  return (
    <div style={{
      height: 'var(--topbar-h)', display: 'flex', alignItems: 'center',
      borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-0)',
      padding: '0 12px', gap: 10, flexShrink: 0,
    }}>
      {/* logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8, borderRight: '1px solid var(--bd-1)', height: '100%' }}>
        <JourneyMark size={18} color="var(--ac)"/>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>journey</span>
      </div>

      {/* project switcher */}
      <button onClick={onOpenSwitcher} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px 5px 8px', background: 'var(--bg-2)',
        border: '1px solid var(--bd-2)', borderRadius: 5,
        fontSize: 12, color: 'var(--fg-0)',
      }}>
        <IconFolder size={13} style={{ color: 'var(--fg-2)' }}/>
        <span className="mono" style={{ fontWeight: 500 }}>{project.name}</span>
        <span style={{ color: 'var(--fg-3)', fontSize: 11 }} className="mono">·</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 11 }} className="mono">{project.branch}</span>
        <IconChevronDown size={11} style={{ color: 'var(--fg-3)', marginLeft: 2 }}/>
      </button>

      {/* env pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
        border: '1px solid var(--bd-1)', borderRadius: 5, fontSize: 11,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ac)' }}/>
        <span className="mono" style={{ color: 'var(--fg-1)' }}>local</span>
        <span className="mono" style={{ color: 'var(--fg-3)' }}>·</span>
        <span className="mono" style={{ color: 'var(--fg-2)' }}>api.ledger.test:4000</span>
      </div>

      <div style={{ flex: 1 }}/>

      {/* cmd-k */}
      <button style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
        border: '1px solid var(--bd-1)', borderRadius: 5, fontSize: 12,
        color: 'var(--fg-2)', minWidth: 220,
      }}>
        <IconSearch size={12}/>
        <span style={{ flex: 1, textAlign: 'left' }}>Search endpoints, journeys…</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', border: '1px solid var(--bd-2)', padding: '1px 4px', borderRadius: 3 }}>⌘K</span>
      </button>

      <div style={{ width: 1, height: 20, background: 'var(--bd-1)' }}/>

      <button onClick={onToggleConsole} title="Toggle console" style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
        borderRadius: 5, fontSize: 12,
        color: consoleOpen ? 'var(--ac)' : 'var(--fg-1)',
        background: consoleOpen ? 'var(--ac-bg)' : 'transparent',
        border: consoleOpen ? '1px solid var(--ac-bd)' : '1px solid transparent',
      }}>
        <IconConsole size={13}/>
        <span>Console</span>
      </button>

      <button onClick={onOpenTweaks} title="Tweaks" style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--fg-2)', borderRadius: 4,
      }}>
        <IconSettings size={14}/>
      </button>
    </div>
  );
}

function Sidebar({ route, setRoute, counts }) {
  const navItems = [
    { id: 'overview',     label: 'Overview',      icon: IconHome,      badge: null },
    { id: 'endpoints',    label: 'Endpoints',     icon: IconEndpoints, badge: counts.endpoints },
    { id: 'journeys',     label: 'Journeys',      icon: IconJourneys,  badge: counts.journeys },
    { id: 'editor',       label: 'Editor',        icon: IconEditor,    badge: null },
    { id: 'files',        label: 'Files',         icon: IconFiles,     badge: null },
    { id: 'environments', label: 'Environments',  icon: IconEnv,       badge: counts.envs },
  ];
  const toolItems = [
    { id: 'diff',     label: 'Spec diff',     icon: IconDiff,    badge: '2' },
    { id: 'history',  label: 'Run history',   icon: IconClock,   badge: null },
    { id: 'mock',     label: 'Mock server',   icon: IconLayers,  badge: null, dim: true },
  ];

  return (
    <div style={{
      width: 'var(--sidebar-w)', flexShrink: 0,
      background: 'var(--bg-0)', borderRight: '1px solid var(--bd-1)',
      display: 'flex', flexDirection: 'column', padding: '10px 8px',
    }}>
      <SidebarSection label="Project">
        {navItems.map(n => (
          <SidebarItem key={n.id} active={route === n.id} onClick={() => setRoute(n.id)} icon={n.icon} label={n.label} badge={n.badge}/>
        ))}
      </SidebarSection>

      <SidebarSection label="Tools">
        {toolItems.map(n => (
          <SidebarItem key={n.id} active={route === n.id} onClick={() => setRoute(n.id)} icon={n.icon} label={n.label} badge={n.badge} dim={n.dim}/>
        ))}
      </SidebarSection>

      <div style={{ flex: 1 }}/>

      {/* project footer */}
      <div style={{ borderTop: '1px solid var(--bd-1)', padding: '10px 6px 2px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-2)' }}>
          <IconGit size={11}/>
          <span className="mono" style={{ color: 'var(--fg-1)' }}>main</span>
          <span className="mono" style={{ color: 'var(--fg-3)' }}>·</span>
          <span className="mono">a1b2c3d</span>
          <span style={{ flex: 1 }}/>
          <span style={{ color: 'var(--ok)' }}>clean</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-3)' }}>
          <span className="mono">v0.8.2</span>
          <span style={{ flex: 1 }}/>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)' }}/>
          <span>serve :4400</span>
        </div>
      </div>
    </div>
  );
}

function SidebarSection({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        padding: '4px 8px 6px', fontSize: 10, fontWeight: 500,
        color: 'var(--fg-3)', letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, onClick, badge, dim }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '6px 8px', borderRadius: 4,
      background: active ? 'var(--bg-3)' : 'transparent',
      color: dim ? 'var(--fg-3)' : active ? 'var(--fg-0)' : 'var(--fg-1)',
      fontSize: 13, width: '100%', textAlign: 'left',
      position: 'relative',
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-1)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      {active && <span style={{
        position: 'absolute', left: -8, top: 6, bottom: 6, width: 2,
        background: 'var(--ac)', borderRadius: '0 2px 2px 0',
      }}/>}
      <Icon size={14} style={{ color: active ? 'var(--ac)' : 'var(--fg-2)' }}/>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && (
        <span className="mono" style={{
          fontSize: 10, color: 'var(--fg-3)',
          padding: '0 4px',
        }}>{badge}</span>
      )}
    </button>
  );
}

// Project switcher dropdown
function ProjectSwitcher({ open, onClose, projects, currentName, onSwitch }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }}/>
      <div style={{
        position: 'absolute', top: 'calc(var(--topbar-h) + 4px)', left: 144, zIndex: 50,
        width: 340, background: 'var(--bg-1)', border: '1px solid var(--bd-2)',
        borderRadius: 6, boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
        padding: 6,
      }}>
        <div style={{ padding: '6px 8px 4px', fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent projects</div>
        {projects.map((p, i) => (
          <button key={p.name} onClick={() => { onSwitch(p.name); onClose(); }} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 8px', borderRadius: 4,
            background: p.name === currentName ? 'var(--bg-3)' : 'transparent',
            textAlign: 'left',
          }}
          onMouseEnter={e => { if (p.name !== currentName) e.currentTarget.style.background = 'var(--bg-2)'; }}
          onMouseLeave={e => { if (p.name !== currentName) e.currentTarget.style.background = 'transparent'; }}>
            <IconFolder size={13} style={{ color: p.name === currentName ? 'var(--ac)' : 'var(--fg-2)' }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }} className="mono">{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }} className="mono">{p.path}</div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg-3)' }} className="mono">{p.branch}</div>
          </button>
        ))}
        <div style={{ borderTop: '1px solid var(--bd-1)', marginTop: 4, paddingTop: 4 }}>
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 8px', borderRadius: 4, color: 'var(--fg-1)', fontSize: 12,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <IconFolder size={13} style={{ color: 'var(--fg-2)' }}/>
            <span>Open folder…</span>
            <span style={{ flex: 1 }}/>
            <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', border: '1px solid var(--bd-2)', padding: '1px 4px', borderRadius: 3 }}>⌘O</span>
          </button>
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 8px', borderRadius: 4, color: 'var(--fg-1)', fontSize: 12,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <IconPlus size={13} style={{ color: 'var(--fg-2)' }}/>
            <span>Init new project…</span>
          </button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { MethodBadge, StatusPill, RunDot, TopBar, Sidebar, ProjectSwitcher });
