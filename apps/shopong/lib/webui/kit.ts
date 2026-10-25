/**
 * The mini-app UI kit: plain CSS classes that look like the PanelUI components in the native
 * screens. Sizes, radii and weights are PanelUI's own; every colour is a `--color-*` variable that
 * `buildMiniAppDocument` fills in from the live PanelUI theme, so light and dark follow the app.
 */

/** The PanelUI theme variables a mini app can use. */
export const THEME_VARIABLES = [
  "--color-background",
  "--color-foreground",
  "--color-card",
  "--color-card-foreground",
  "--color-popover",
  "--color-primary",
  "--color-primary-foreground",
  "--color-secondary",
  "--color-secondary-foreground",
  "--color-muted",
  "--color-muted-foreground",
  "--color-destructive",
  "--color-destructive-solid-foreground",
  "--color-border",
  "--color-input",
  "--color-ring",
] as const;

export const KIT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
[hidden]{display:none !important}
body{margin:0;padding:24px;background:var(--color-background);color:var(--color-foreground);font-family:system-ui,-apple-system,"Roboto",sans-serif;font-size:16px;line-height:24px;-webkit-tap-highlight-color:transparent}

.ui-stack{display:flex;flex-direction:column;gap:16px}
.ui-row{display:flex;align-items:center;gap:12px}
.ui-grow{flex:1;min-width:0}
.ui-center{align-items:center;justify-content:center;text-align:center;min-height:calc(100vh - 48px)}

.ui-text{margin:0;color:var(--color-foreground)}
.ui-text-xs{font-size:12px;line-height:16px}
.ui-text-sm{font-size:14px;line-height:20px}
.ui-text-lg{font-size:18px;line-height:28px}
.ui-text-xl{font-size:20px;line-height:28px}
.ui-text-2xl{font-size:24px;line-height:32px}
.ui-text-3xl{font-size:30px;line-height:36px}
.ui-medium{font-weight:500}
.ui-semibold{font-weight:600}
.ui-bold{font-weight:700}
.ui-muted{color:var(--color-muted-foreground)}

.ui-card{background:var(--color-card);color:var(--color-card-foreground);border:1px solid var(--color-border);border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.ui-card-header{display:flex;flex-direction:column;gap:4px;padding:24px 24px 0}
.ui-card-content{padding:24px}

.ui-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:44px;min-height:44px;padding:10px 16px;border:1px solid var(--color-primary);border-radius:10px;background:var(--color-primary);color:var(--color-primary-foreground);font:inherit;font-size:16px;font-weight:500;line-height:24px;box-shadow:0 1px 2px rgba(0,0,0,.05);cursor:pointer}
.ui-button:active{opacity:.8}
.ui-button:disabled{opacity:.64;cursor:default}
.ui-button--secondary{border-color:transparent;background:var(--color-secondary);color:var(--color-secondary-foreground);box-shadow:none}
.ui-button--outline{border-color:var(--color-input);background:var(--color-popover);color:var(--color-foreground)}
.ui-button--ghost{border-color:transparent;background:transparent;color:var(--color-foreground);box-shadow:none}
.ui-button--destructive{border-color:var(--color-destructive);background:var(--color-destructive);color:var(--color-destructive-solid-foreground)}
.ui-button--sm{min-width:36px;min-height:36px;padding:8px 10px;gap:6px;font-size:14px;line-height:20px}
.ui-button--lg{min-height:48px;padding:10px 24px;font-size:18px}
.ui-button--full{width:100%}

.ui-field{display:flex;flex-direction:column;gap:6px}
.ui-label{font-size:14px;line-height:20px;font-weight:500;color:var(--color-foreground)}
.ui-input{width:100%;height:48px;padding:0 14px;border:1px solid var(--color-input);border-radius:10px;background:var(--color-background);color:var(--color-foreground);font:inherit;font-size:16px;outline:none}
.ui-input::placeholder{color:var(--color-muted-foreground)}
.ui-input:focus{border-color:var(--color-ring)}
.ui-description{margin:0;font-size:14px;line-height:20px;color:var(--color-muted-foreground)}
.ui-error{margin:0;font-size:14px;line-height:20px;color:var(--color-destructive)}

.ui-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:var(--color-secondary);color:var(--color-secondary-foreground);font-size:12px;line-height:16px;font-weight:500}
.ui-separator{height:1px;margin:0;border:0;background:var(--color-border)}
.ui-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.ui-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-border)}
.ui-item:last-child{border-bottom:0}
`;
