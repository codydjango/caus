import { useState, useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type TimerState = { started_at: number; completes_at: number };
type UpgradeTimerState = TimerState & { from_level: number; to_level: number };
type PlayerState = { money: number; version: number };
type SiteState = {
  has_farm: boolean;
  level: number;
  build_in_progress: TimerState | null;
  upgrade_in_progress: UpgradeTimerState | null;
  version: number;
};
type Snapshot = {
  player: PlayerState;
  site: SiteState;
  world_clock_us: number;
  game_event_count: number;
  tick_count: number;
  completion_count: number;
  paused: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtSeconds(us: number) {
  const s = Math.floor(us / 1_000_000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function timerProgress(timer: TimerState, nowUs: number) {
  const total = timer.completes_at - timer.started_at;
  const elapsed = nowUs - timer.started_at;
  return Math.min(1, Math.max(0, elapsed / total));
}

function timerRemaining(timer: TimerState, nowUs: number) {
  return fmtSeconds(Math.max(0, timer.completes_at - nowUs));
}

async function api(path: string, body?: unknown): Promise<Snapshot> {
  const res = await fetch(path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Snapshot>;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ value, label, paused }: { value: number; label: string; paused: boolean }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{label}</div>
      <div style={{ background: '#222', borderRadius: 4, height: 10, overflow: 'hidden' }}>
        <div
          style={{
            width: `${(value * 100).toFixed(1)}%`,
            height: '100%',
            background: value >= 1 ? '#4caf50' : paused ? '#888' : '#2196f3',
            transition: paused ? 'none' : 'width 0.25s linear',
          }}
        />
      </div>
    </div>
  );
}

function Btn({
  onClick,
  disabled,
  danger,
  muted,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 14px',
        borderRadius: 4,
        border: 'none',
        background: danger ? '#c0392b' : muted ? '#2a2a2a' : disabled ? '#222' : '#1976d2',
        color: disabled ? '#444' : muted ? '#888' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 13,
        marginRight: 8,
        marginBottom: 6,
      }}
    >
      {children}
    </button>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [nowUs, setNowUs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [giveAmount, setGiveAmount] = useState(100);
  const [wsUpdates, setWsUpdates] = useState(0);
  const clockBaseRef = useRef<{ serverUs: number; localMs: number; paused: boolean } | null>(null);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let ws: WebSocket;
    let alive = true;

    function connect() {
      ws = new WebSocket('ws://localhost:3001');
      ws.onmessage = (evt) => {
        const s = JSON.parse(evt.data as string) as Snapshot;
        setSnap(s);
        setWsUpdates((n) => n + 1);
        clockBaseRef.current = {
          serverUs: s.world_clock_us,
          localMs: performance.now(),
          paused: s.paused,
        };
      };
      ws.onclose = () => {
        if (alive) setTimeout(connect, 1000);
      };
    }
    connect();
    return () => { alive = false; ws.close(); };
  }, []);

  // ── Local clock interpolation (stops when paused) ──────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const base = clockBaseRef.current;
      if (!base) return;
      if (base.paused) {
        setNowUs(base.serverUs); // frozen
      } else {
        setNowUs(Math.floor(base.serverUs + (performance.now() - base.localMs) * 1000));
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // ── Command helper ─────────────────────────────────────────────────────────
  function run(fn: () => Promise<Snapshot>) {
    setError(null);
    fn()
      .then((s) => {
        setSnap(s);
        clockBaseRef.current = { serverUs: s.world_clock_us, localMs: performance.now(), paused: s.paused };
      })
      .catch((e: Error) => setError(e.message));
  }

  const site = snap?.site;
  const player = snap?.player;
  const isPaused = snap?.paused ?? false;

  const canBuild = snap !== null && !site?.has_farm && !site?.build_in_progress;
  const canUpgrade =
    snap !== null &&
    site?.has_farm === true &&
    !site.upgrade_in_progress &&
    !site.build_in_progress &&
    player !== undefined &&
    player.money >= 100 * (site.level ?? 1);

  const buildProgress = site?.build_in_progress ? timerProgress(site.build_in_progress, nowUs) : null;
  const upgradeProgress = site?.upgrade_in_progress ? timerProgress(site.upgrade_in_progress, nowUs) : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        fontFamily: 'monospace',
        background: '#0d0d0d',
        color: '#e0e0e0',
        minHeight: '100vh',
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20 }}>
        <h2 style={{ margin: 0, color: '#aaa', fontWeight: 400, letterSpacing: 2 }}>
          CAUSALITY <span style={{ color: '#444' }}>// debug</span>
        </h2>
        {isPaused && (
          <span style={{ fontSize: 11, color: '#f39c12', letterSpacing: 1 }}>⏸ PAUSED</span>
        )}
      </div>

      {/* ── World clock & stats ── */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          marginBottom: 20,
          padding: 16,
          background: '#111',
          borderRadius: 6,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ color: '#555', fontSize: 11, marginBottom: 4 }}>WORLD CLOCK</div>
          <div style={{ fontSize: 28, color: isPaused ? '#888' : '#76ff03', letterSpacing: 1 }}>
            {fmtSeconds(nowUs)}
          </div>
          <div style={{ color: '#444', fontSize: 10, marginTop: 2 }}>
            {nowUs.toLocaleString()} µs
          </div>
        </div>

        <div style={{ borderLeft: '1px solid #222', paddingLeft: 24 }}>
          <Stat
            label="GAME EVENTS"
            value={snap?.game_event_count ?? 0}
            hint="excludes WorldTickAdvanced"
          />
          <Stat
            label="TICK EVENTS"
            value={snap?.tick_count ?? 0}
            hint="WorldTickAdvanced, one per second"
          />
          <Stat label="COMPLETIONS" value={snap?.completion_count ?? 0} />
          <Stat label="WS UPDATES" value={wsUpdates} />
        </div>

        <div style={{ borderLeft: '1px solid #222', paddingLeft: 24 }}>
          <Stat label="MONEY" value={`$${player?.money ?? 0}`} />
          <Stat
            label="FARM"
            value={
              !site?.has_farm && !site?.build_in_progress
                ? 'none'
                : site?.build_in_progress
                  ? `building… (${timerRemaining(site.build_in_progress, nowUs)} left)`
                  : `level ${site?.level}`
            }
          />
          {site?.upgrade_in_progress && (
            <Stat
              label="UPGRADE"
              value={`L${site.upgrade_in_progress.from_level}→L${site.upgrade_in_progress.to_level} (${timerRemaining(site.upgrade_in_progress, nowUs)} left)`}
            />
          )}
        </div>

        {/* Pause/Resume lives in the clock panel */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-start' }}>
          <Btn
            muted={!isPaused}
            onClick={() => run(() => api(isPaused ? '/api/resume' : '/api/pause', {}))}
          >
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </Btn>
        </div>
      </div>

      {/* ── Timer progress bars ── */}
      {(buildProgress !== null || upgradeProgress !== null) && (
        <div style={{ marginBottom: 20, padding: 16, background: '#111', borderRadius: 6 }}>
          {buildProgress !== null && (
            <ProgressBar
              value={buildProgress}
              label={`Farm build — ${timerRemaining(site!.build_in_progress!, nowUs)} remaining${isPaused ? ' (paused)' : ''}`}
              paused={isPaused}
            />
          )}
          {upgradeProgress !== null && (
            <ProgressBar
              value={upgradeProgress}
              label={`Upgrade L${site!.upgrade_in_progress!.from_level}→L${site!.upgrade_in_progress!.to_level} — ${timerRemaining(site!.upgrade_in_progress!, nowUs)} remaining${isPaused ? ' (paused)' : ''}`}
              paused={isPaused}
            />
          )}
        </div>
      )}

      {/* ── Game actions ── */}
      <Section label="GAME ACTIONS">
        <Btn onClick={() => run(() => api('/api/commands/build-farm', {}))} disabled={!canBuild}>
          Build Farm{!canBuild ? (site?.has_farm ? ' (exists)' : site?.build_in_progress ? ' (in progress)' : '') : ''}
        </Btn>
        <Btn onClick={() => run(() => api('/api/commands/upgrade-farm', {}))} disabled={!canUpgrade}>
          Upgrade Farm {site?.has_farm ? `(costs $${100 * (site.level ?? 1)})` : '(no farm)'}
        </Btn>
      </Section>

      {/* ── Debug actions ── */}
      <Section label="DEBUG ACTIONS">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="number"
            value={giveAmount}
            min={1}
            onChange={(e) => setGiveAmount(Number(e.target.value))}
            style={{
              width: 80,
              padding: '5px 8px',
              background: '#1a1a1a',
              border: '1px solid #333',
              color: '#e0e0e0',
              borderRadius: 4,
              fontSize: 13,
            }}
          />
          <Btn onClick={() => run(() => api('/api/commands/give-money', { amount: giveAmount }))}>
            Give Money
          </Btn>
        </div>
        <div>
          <Btn
            danger
            onClick={() => {
              setWsUpdates(0);
              run(() => api('/api/reset', {}));
            }}
          >
            Reset World
          </Btn>
          <span style={{ fontSize: 11, color: '#555' }}>
            clears all events and restarts the clock from t=0
          </span>
        </div>
      </Section>

      {/* ── Error ── */}
      {error && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 14px',
            background: '#1a0a0a',
            border: '1px solid #c0392b',
            borderRadius: 4,
            color: '#e57373',
            fontSize: 13,
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: 12, background: 'none', border: 'none', color: '#e57373', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Raw snapshot ── */}
      <details style={{ marginTop: 24 }}>
        <summary style={{ color: '#444', fontSize: 12, cursor: 'pointer' }}>raw snapshot</summary>
        <pre style={{ marginTop: 8, padding: 12, background: '#111', borderRadius: 4, fontSize: 11, color: '#666', overflow: 'auto' }}>
          {JSON.stringify(snap, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={{ marginBottom: 8 }} title={hint}>
      <span style={{ color: '#555', fontSize: 10 }}>{label} </span>
      <span style={{ color: '#ccc', fontSize: 13 }}>{value}</span>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20, padding: 16, background: '#111', borderRadius: 6 }}>
      <div style={{ color: '#444', fontSize: 11, marginBottom: 10, letterSpacing: 1 }}>{label}</div>
      {children}
    </div>
  );
}
