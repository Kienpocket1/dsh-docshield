/** Card styles built on DSH design tokens (--dsw-alias-*), with fallbacks for light and dark themes. */
export const CSS = `
.dsd-card{--dsd-ink:var(--dsw-alias-label-primary,#172026);--dsd-muted:var(--dsw-alias-label-tertiary,#74808a);--dsd-line:var(--dsw-alias-border-l2,#e3e7e9);--dsd-layer:var(--dsw-alias-bg-layer-2,#f8fafb);--dsd-accent:var(--dsw-alias-brand-primary,#14b8a6);--dsd-ok:var(--dsw-alias-state-success-primary,#10b981);--dsd-warn:var(--dsw-alias-state-warn-primary,#f59e0b);--dsd-bad:var(--dsw-alias-state-error-primary,#ef4444);
  border:1px solid var(--dsd-line);border-radius:12px;background:var(--dsd-layer);color:var(--dsd-ink);padding:12px 14px;margin:6px 0;font-size:13px;line-height:1.55;display:flex;flex-direction:column;gap:8px;max-width:760px}
.dsd-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsd-title{font-weight:600}
.dsd-icon{width:18px;text-align:center}
.dsd-muted{color:var(--dsd-muted,#74808a)}
.dsd-file{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.dsd-answer{font-size:14px}
.dsd-evidence{border-left:4px solid var(--dsd-ok)}
.dsd-sources{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px}
.dsd-source-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsd-quote{margin:4px 0 0;padding:6px 10px;border-left:3px solid var(--dsd-line);color:var(--dsd-ink);font-style:italic}
.dsd-badge{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsd-line)}
.dsd-badge-public{color:var(--dsd-accent);border-color:color-mix(in srgb,var(--dsd-accent) 45%,transparent)}
.dsd-badge-private{color:var(--dsd-muted)}
.dsd-ticket{border:1px solid color-mix(in srgb,var(--dsd-warn) 55%,transparent);background:color-mix(in srgb,var(--dsd-warn) 10%,var(--dsd-layer))}
.dsd-pill{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px}
.dsd-pill-open{background:color-mix(in srgb,var(--dsd-warn,#f59e0b) 22%,transparent);color:var(--dsd-warn,#b45309)}
.dsd-pill-in_progress{background:color-mix(in srgb,var(--dsd-accent,#14b8a6) 20%,transparent);color:var(--dsd-accent,#0f766e)}
.dsd-pill-resolved{background:color-mix(in srgb,var(--dsd-ok,#10b981) 20%,transparent);color:var(--dsd-ok,#047857)}
.dsd-pill-rejected{background:color-mix(in srgb,var(--dsd-bad,#ef4444) 20%,transparent);color:var(--dsd-bad,#b91c1c)}
.dsd-reply-rejected{background:color-mix(in srgb,var(--dsd-bad) 10%,transparent)}
.dsd-reply{padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsd-ok) 10%,transparent)}
.dsd-actions{display:flex;gap:8px}
.dsd-button{font:inherit;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsd-line);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsd-ink);cursor:pointer}
.dsd-button:disabled{opacity:.65;cursor:default}
.dsd-error{border-left:4px solid var(--dsd-bad)}
.dsd-bad{color:var(--dsd-bad)}
.dsd-busy{color:var(--dsd-accent)}
.dsd-busy .dsd-spinner{display:inline-block;vertical-align:-2px;width:10px;height:10px;margin-right:6px}
.dsd-pending{flex-direction:row;align-items:center;color:var(--dsd-muted)}
.dsd-spinner{width:12px;height:12px;border:2px solid var(--dsd-line);border-top-color:var(--dsd-accent);border-radius:50%;animation:dsdSpin .8s linear infinite;margin-right:8px}
@keyframes dsdSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dsd-spinner{animation:none}}
.dsd-table{border-collapse:collapse;width:100%;font-size:12px}
.dsd-table th,.dsd-table td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--dsd-line);vertical-align:top}
.dsd-table th{color:var(--dsd-muted);font-weight:500}
.dsd-row{--dsd-muted:var(--dsw-alias-label-tertiary,#74808a);--dsd-line:var(--dsw-alias-border-l2,#e3e7e9);--dsd-accent:var(--dsw-alias-brand-primary,#14b8a6);--dsd-ok:var(--dsw-alias-state-success-primary,#10b981);--dsd-warn:var(--dsw-alias-state-warn-primary,#f59e0b);font-size:12px;margin:2px 0}
.dsd-row-static{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsd-row-toggle{display:flex;align-items:center;gap:8px;background:none;border:0;padding:2px 0;font:inherit;color:inherit;cursor:pointer}
.dsd-row-toggle:disabled{cursor:default}
.dsd-hitlist{margin:4px 0 0 26px;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
`
