import React, { useEffect, useRef, useState } from 'react';
import { AppState } from '../App';

type Props = {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  onDone: (summary: AutomationSummary, logs: string[]) => void;
};

export interface FailedTabEntry {
  tabNum: number;
  pnr:    string;
  reason: string;
}

export interface AutomationSummary {
  totalProcessed:   number;
  successCount:     number;
  noPassportCount:  number;
  failedCount:      number;
  failedPnrs:       string[];
  failedTabEntries: FailedTabEntry[];
  outputPath:       string;
}

type RunState = 'idle' | 'running' | 'paused' | 'done' | 'stopped';

const Screen3: React.FC<Props> = ({ appState, onDone }) => {
  const [runState, setRunState] = useState<RunState>('idle');
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentPnr, setCurrentPnr] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const logsRef = useRef<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg: string) =>
    setLogs(prev => {
      const next = [...prev, msg];
      logsRef.current = next;
      return next;
    });

  // Subscribe to Electron events when component mounts
  useEffect(() => {
    const unsubLog = window.electronAPI.onLog(addLog);

    const unsubProgress = window.electronAPI.onProgress(update => {
      setCurrent(update.current);
      setTotal(update.total);
      setCurrentPnr(update.currentPnr);
    });

    const unsubDone = window.electronAPI.onDone(summary => {
      setRunState('done');
      playCompletionChime();
      onDone(summary, logsRef.current);
    });

    return () => {
      unsubLog();
      unsubProgress();
      unsubDone();
    };
  }, [onDone]);

  const handleStart = async () => {
    if (!appState.excelTemplatePath || !appState.outputFolderPath) return;

    setLogs([]);
    logsRef.current = [];
    setCurrent(0);
    setTotal(appState.tabCount);
    setRunState('running');

    await window.electronAPI.startAutomation({
      excelTemplatePath: appState.excelTemplatePath,
      outputFolderPath: appState.outputFolderPath,
      fileCode: appState.fileCode,
    });
  };

  const handlePause = () => {
    setRunState('paused');
    window.electronAPI.pauseAutomation();
  };

  const handleResume = () => {
    setRunState('running');
    window.electronAPI.resumeAutomation();
  };

  const handleStop = () => {
    setRunState('stopped');
    window.electronAPI.stopAutomation();
    addLog('🛑 Stop requested — finishing current tab…');
  };

  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <div className="logo">✈</div>
        <h1>Saudia Automation</h1>
        <p className="step-label">Step 3 of 4 — Running Automation</p>
        <span className="port-badge">Port {appState.port}</span>
      </div>

      {/* Progress area */}
      <div className="card progress-card">
        <div className="progress-meta">
          <span className="progress-label">
            {runState === 'idle'    && 'Ready to start'}
            {runState === 'running' && (currentPnr ? `Processing: ${currentPnr.slice(0, 60)}…` : 'Processing…')}
            {runState === 'paused'  && 'Paused'}
            {runState === 'done'    && 'Automation complete'}
            {runState === 'stopped' && 'Automation stopped'}
          </span>
          <span className="progress-count">
            {current} / {total || appState.tabCount || 0} tabs
          </span>
        </div>

        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="progress-percent">{percent}%</div>
      </div>

      {/* Live log */}
      <div className="card log-card">
        <div className="log-header">
          Live Log
          <button
            className="btn-copy-log"
            title="Copy all log lines to clipboard"
            onClick={() => {
              navigator.clipboard.writeText(logs.join('\n')).catch(() => {});
            }}
          >
            📋 Copy Log
          </button>
        </div>
        <div className="log-body">
          {logs.length === 0 && (
            <span className="log-empty">Log output will appear here when automation starts…</span>
          )}
          {logs.map((line, i) => (
            <div key={i} className={`log-line ${getLogClass(line)}`}>
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Controls */}
      <div className="screen-footer footer-split">
        <div className="control-group">
          {runState === 'idle' && (
            <button className="btn btn-primary" onClick={handleStart}>
              ▶ Start Automation
            </button>
          )}
          {runState === 'running' && (
            <>
              <button className="btn btn-outline" onClick={handlePause}>
                ⏸ Pause
              </button>
              <button className="btn btn-danger" onClick={handleStop}>
                ⏹ Stop
              </button>
            </>
          )}
          {runState === 'paused' && (
            <>
              <button className="btn btn-primary" onClick={handleResume}>
                ▶ Resume
              </button>
              <button className="btn btn-danger" onClick={handleStop}>
                ⏹ Stop
              </button>
            </>
          )}
          {(runState === 'done' || runState === 'stopped') && (
            <>
              <span className="run-done-label">
                {runState === 'done' ? '✅ Complete — see summary on next screen' : '🛑 Stopped'}
              </span>
              <button
                className="btn btn-outline"
                onClick={() => navigator.clipboard.writeText(logs.join('\n')).catch(() => {})}
              >
                📋 Copy Log
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function playCompletionChime(): void {
  try {
    const ctx = new AudioContext();
    // C5 → E5 → G5 → C6 ascending ding
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.start(t);
      osc.stop(t + 0.7);
    });
  } catch {
    // AudioContext not available — silent fallback
  }
}

function getLogClass(line: string): string {
  if (line.includes('❌') || line.includes('FAIL') || line.includes('ERROR')) return 'log-error';
  if (line.includes('⚠️') || line.includes('WARNING')) return 'log-warn';
  if (line.includes('✅') || line.includes('Done')) return 'log-success';
  if (line.startsWith('──') || line.startsWith('══')) return 'log-divider';
  return '';
}

export default Screen3;
