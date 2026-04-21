// Journey — custom icon set. 16px, 1.5 stroke, square corners.
const I = ({ children, size = 16, stroke = 1.5, style }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeWidth={stroke} strokeLinecap="square" strokeLinejoin="miter"
    style={{ flexShrink: 0, ...style }}>
    {children}
  </svg>
);

const IconHome      = (p) => <I {...p}><path d="M2.5 7L8 2.5 13.5 7v6.5h-4v-4h-3v4h-4V7z"/></I>;
const IconEndpoints = (p) => <I {...p}><circle cx="3" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/><path d="M4.5 8h7"/><path d="M6.5 5.5l-2 2.5 2 2.5M9.5 5.5l2 2.5-2 2.5"/></I>;
const IconJourneys  = (p) => <I {...p}><circle cx="3" cy="3" r="1.5"/><circle cx="13" cy="13" r="1.5"/><path d="M3 4.5v3a3 3 0 003 3h4a3 3 0 013 3v-.5"/></I>;
const IconFiles     = (p) => <I {...p}><path d="M2.5 3.5h4l1 1.5h6v8h-11z"/></I>;
const IconEnv       = (p) => <I {...p}><path d="M2.5 4h11v8h-11z"/><path d="M2.5 6.5h11"/><circle cx="4.5" cy="5.2" r="0.4" fill="currentColor"/><circle cx="6" cy="5.2" r="0.4" fill="currentColor"/></I>;
const IconEditor    = (p) => <I {...p}><path d="M2.5 4l2 1.5-2 1.5M6 7.5h5"/><path d="M2.5 10.5h9"/></I>;
const IconConsole   = (p) => <I {...p}><rect x="1.5" y="2.5" width="13" height="11"/><path d="M4 6l2 1.5-2 1.5M7.5 9.5h3"/></I>;
const IconSearch    = (p) => <I {...p}><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></I>;
const IconPlay      = (p) => <I {...p}><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></I>;
const IconStop      = (p) => <I {...p}><rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/></I>;
const IconCheck     = (p) => <I {...p}><path d="M3 8.5L6.5 12l7-8"/></I>;
const IconX         = (p) => <I {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></I>;
const IconChevron   = (p) => <I {...p}><path d="M5 3l4 5-4 5"/></I>;
const IconChevronDown = (p) => <I {...p}><path d="M3 5l5 4 5-4"/></I>;
const IconPlus      = (p) => <I {...p}><path d="M8 2.5v11M2.5 8h11"/></I>;
const IconDot       = (p) => <I {...p}><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/></I>;
const IconCopy      = (p) => <I {...p}><rect x="2.5" y="2.5" width="8" height="8"/><path d="M5.5 10.5v3h8v-8h-3"/></I>;
const IconEye       = (p) => <I {...p}><path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z"/><circle cx="8" cy="8" r="1.5"/></I>;
const IconEyeOff    = (p) => <I {...p}><path d="M2 8s2.5-4 6-4c1 0 1.9.3 2.7.7M14 8s-2.5 4-6 4c-1 0-1.9-.3-2.7-.7"/><path d="M2 2l12 12"/></I>;
const IconFilter    = (p) => <I {...p}><path d="M2 3.5h12L9.5 9v4l-3-1.5V9z"/></I>;
const IconTrail     = (p) => <I {...p}><circle cx="3" cy="3" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="13" r="1"/><path d="M3.7 3.7l3.6 3.6M8.7 8.7l3.6 3.6" strokeDasharray="1.5 1.5"/></I>;
const IconFolder    = (p) => <I {...p}><path d="M1.5 4h5l1 1.5h7v8h-13z"/></I>;
const IconGit       = (p) => <I {...p}><circle cx="4" cy="3.5" r="1.3"/><circle cx="4" cy="12.5" r="1.3"/><circle cx="12" cy="8" r="1.3"/><path d="M4 5v6M5 8h5.5"/></I>;
const IconLayers    = (p) => <I {...p}><path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/></I>;
const IconClock     = (p) => <I {...p}><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5"/></I>;
const IconSettings  = (p) => <I {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3"/></I>;
const IconCmd       = (p) => <I {...p}><path d="M5.5 4.5h5v7h-5z"/><path d="M5.5 6a1.5 1.5 0 11-1.5 1.5h1.5M10.5 6a1.5 1.5 0 111.5 1.5H10.5M5.5 10a1.5 1.5 0 10-1.5-1.5h1.5M10.5 10a1.5 1.5 0 101.5-1.5H10.5"/></I>;
const IconDiff      = (p) => <I {...p}><path d="M4 2v8a2 2 0 002 2h1M4 2l-1.5 1.5M4 2l1.5 1.5"/><path d="M12 14V6a2 2 0 00-2-2H9M12 14l1.5-1.5M12 14l-1.5-1.5"/></I>;
const IconDocked    = (p) => <I {...p}><rect x="1.5" y="2.5" width="13" height="11"/><path d="M1.5 10h13"/></I>;
const IconRefresh   = (p) => <I {...p}><path d="M13 7A5 5 0 003.5 5M3 2v3h3M3 9a5 5 0 009.5 2M13 14v-3h-3"/></I>;

// Journey wordmark mark — three waypoints on a line
const JourneyMark = ({ size = 22, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M3 18 L9 12 L15 14 L21 6" stroke={color} strokeWidth="1.75" strokeLinecap="square"/>
    <circle cx="3" cy="18" r="2" fill={color}/>
    <circle cx="9" cy="12" r="1.5" fill={color}/>
    <circle cx="15" cy="14" r="1.5" fill={color}/>
    <circle cx="21" cy="6" r="2" fill={color}/>
  </svg>
);

Object.assign(window, {
  IconHome, IconEndpoints, IconJourneys, IconFiles, IconEnv, IconEditor,
  IconConsole, IconSearch, IconPlay, IconStop, IconCheck, IconX,
  IconChevron, IconChevronDown, IconPlus, IconDot, IconCopy, IconEye,
  IconEyeOff, IconFilter, IconTrail, IconFolder, IconGit, IconLayers,
  IconClock, IconSettings, IconCmd, IconDiff, IconDocked, IconRefresh,
  JourneyMark,
});
