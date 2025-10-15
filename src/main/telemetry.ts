import { app } from 'electron';
// Optional build-time defaults for distribution bundles
// Loaded dynamically so dev builds don't require the JSON to be copied to dist.
let appConfig: { posthogHost?: string; posthogKey?: string } = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  appConfig = require('./appConfig.json');
} catch {
  appConfig = {};
}
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type TelemetryEvent =
  | 'app_started'
  | 'app_closed'
  | 'feature_used'
  | 'error'
  // Aggregates (privacy-safe)
  | 'workspace_snapshot'
  // Session summary (duration only)
  | 'app_session';

interface InitOptions {
  installSource?: string;
}

let enabled = true;
let apiKey: string | undefined;
let host: string | undefined;
let instanceId: string | undefined;
let installSource: string | undefined;
let userOptOut: boolean | undefined; // persisted user setting
let sessionStartMs: number = Date.now();

const libName = 'emdash';

function getVersionSafe(): string {
  try {
    return app.getVersion();
  } catch {
    return 'unknown';
  }
}

function getInstanceIdPath(): string {
  const dir = app.getPath('userData');
  return join(dir, 'telemetry.json');
}

function loadOrCreateState(): { instanceId: string; enabledOverride?: boolean } {
  try {
    const file = getInstanceIdPath();
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.instanceId === 'string' && parsed.instanceId.length > 0) {
        const enabledOverride =
          typeof parsed.enabled === 'boolean' ? (parsed.enabled as boolean) : undefined;
        return { instanceId: parsed.instanceId as string, enabledOverride };
      }
    }
  } catch {
    // fall through to create
  }
  // Create new random ID
  const id = cryptoRandomId();
  try {
    persistState({ instanceId: id });
  } catch {
    // ignore write errors; still use in-memory id
  }
  return { instanceId: id };
}

function cryptoRandomId(): string {
  try {
    const { randomUUID } = require('crypto');
    return randomUUID();
  } catch {
    // Very old Node fallback; not expected in Electron 28+
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function isEnabled(): boolean {
  return (
    enabled === true &&
    userOptOut !== true &&
    !!apiKey &&
    !!host &&
    typeof instanceId === 'string' &&
    instanceId.length > 0
  );
}

function getBaseProps() {
  return {
    app_version: getVersionSafe(),
    electron_version: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    is_dev: !app.isPackaged,
    install_source: installSource ?? (app.isPackaged ? 'dmg' : 'dev'),
    $lib: libName,
  } as const;
}

function sanitizeEventAndProps(event: TelemetryEvent, props: Record<string, any> | undefined) {
  const p: Record<string, any> = {};
  const baseAllowed = new Set([
    // explicitly allow only these keys to avoid PII
    'feature',
    'type',
    // session
    'session_duration_ms',
    // aggregates (counts + buckets only)
    'workspace_count',
    'workspace_count_bucket',
    'project_count',
    'project_count_bucket',
  ]);

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (!baseAllowed.has(k)) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        p[k] = v;
      }
    }
  }

  // Helpers
  const clampInt = (n: any, min = 0, max = 10_000_000) => {
    const v = typeof n === 'number' ? Math.floor(n) : Number.parseInt(String(n), 10);
    if (!Number.isFinite(v)) return undefined;
    return Math.min(Math.max(v, min), max);
  };

  const BUCKETS = new Set(['0', '1-2', '3-5', '6-10', '>10']);

  // Event-specific constraints
  switch (event) {
    case 'feature_used':
      // Only retain a simple feature name
      if (typeof p.feature !== 'string') delete p.feature;
      break;
    case 'error':
      if (typeof p.type !== 'string') delete p.type;
      break;
    case 'app_session':
      // Only duration
      if (p.session_duration_ms != null) {
        const v = clampInt(p.session_duration_ms, 0, 1000 * 60 * 60 * 24); // up to 24h
        if (v == null) delete p.session_duration_ms;
        else p.session_duration_ms = v;
      }
      // strip any other keys
      for (const k of Object.keys(p)) if (k !== 'session_duration_ms') delete p[k];
      break;
    case 'workspace_snapshot':
      // Allow only counts and very coarse buckets
      if (p.workspace_count != null) {
        const v = clampInt(p.workspace_count, 0, 100000);
        if (v == null) delete p.workspace_count;
        else p.workspace_count = v;
      }
      if (p.project_count != null) {
        const v = clampInt(p.project_count, 0, 100000);
        if (v == null) delete p.project_count;
        else p.project_count = v;
      }
      if (p.workspace_count_bucket && !BUCKETS.has(String(p.workspace_count_bucket))) {
        delete p.workspace_count_bucket;
      }
      if (p.project_count_bucket && !BUCKETS.has(String(p.project_count_bucket))) {
        delete p.project_count_bucket;
      }
      // strip anything else
      for (const k of Object.keys(p)) {
        if (
          k !== 'workspace_count' &&
          k !== 'workspace_count_bucket' &&
          k !== 'project_count' &&
          k !== 'project_count_bucket'
        ) {
          delete p[k];
        }
      }
      break;
    default:
      // no additional props for lifecycle events
      for (const k of Object.keys(p)) delete p[k];
      break;
  }

  return p;
}

async function posthogCapture(
  event: TelemetryEvent,
  properties?: Record<string, any>
): Promise<void> {
  if (!isEnabled()) return;
  try {
    // Use global fetch if available (Node 18+/Electron 28+)
    const f: any = (globalThis as any).fetch;
    if (!f) return;
    const u = (host || '').replace(/\/$/, '') + '/capture/';
    const body = {
      api_key: apiKey,
      event,
      properties: {
        distinct_id: instanceId,
        ...getBaseProps(),
        ...sanitizeEventAndProps(event, properties),
      },
    };
    await f(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // swallow errors; telemetry must never crash the app
  }
}

export function init(options?: InitOptions) {
  const env = process.env;
  const enabledEnv = (env.TELEMETRY_ENABLED ?? 'true').toString().toLowerCase();
  enabled = enabledEnv !== 'false' && enabledEnv !== '0' && enabledEnv !== 'no';
  apiKey =
    env.POSTHOG_PROJECT_API_KEY || (appConfig?.posthogKey as string | undefined) || undefined;
  host = env.POSTHOG_HOST || (appConfig?.posthogHost as string | undefined) || undefined;
  installSource = options?.installSource || env.INSTALL_SOURCE || undefined;

  const state = loadOrCreateState();
  instanceId = state.instanceId;
  sessionStartMs = Date.now();
  // If enabledOverride is explicitly false, user opted out; otherwise leave undefined
  userOptOut =
    typeof state.enabledOverride === 'boolean' ? state.enabledOverride === false : undefined;

  // Fire lifecycle start
  void posthogCapture('app_started');
}

export function capture(event: TelemetryEvent, properties?: Record<string, any>) {
  void posthogCapture(event, properties);
}

export function shutdown() {
  // No-op for now (no batching). Left for future posthog-node integration.
}

export function isTelemetryEnabled(): boolean {
  return isEnabled();
}

export function getTelemetryStatus() {
  return {
    enabled: isEnabled(),
    envDisabled: !enabled,
    userOptOut: userOptOut === true,
    hasKeyAndHost: !!apiKey && !!host,
  };
}

export function setTelemetryEnabledViaUser(enabledFlag: boolean) {
  userOptOut = !enabledFlag;
  // Persist alongside instanceId
  try {
    const file = getInstanceIdPath();
    let state: any = {};
    if (existsSync(file)) {
      try {
        state = JSON.parse(readFileSync(file, 'utf8')) || {};
      } catch {
        state = {};
      }
    }
    state.instanceId = instanceId || state.instanceId || cryptoRandomId();
    state.enabled = enabledFlag; // store explicit preference
    state.updatedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function persistState(state: { instanceId: string; enabledOverride?: boolean }) {
  try {
    const existing = existsSync(getInstanceIdPath())
      ? JSON.parse(readFileSync(getInstanceIdPath(), 'utf8'))
      : {};
    const merged = {
      ...existing,
      instanceId: state.instanceId,
      enabled:
        typeof state.enabledOverride === 'boolean' ? state.enabledOverride : existing.enabled,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(getInstanceIdPath(), JSON.stringify(merged, null, 2), 'utf8');
  } catch {
    // ignore
  }
}
