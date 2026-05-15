import React from 'react';
import { AppState } from '../App';
import { AutomationSummary } from './Screen3';

type Props = {
  appState: AppState;
  onNewRun: () => void;
};

const Screen4: React.FC<Props> = ({ appState, onNewRun }) => {
  const summary = appState.automationSummary;

  if (!summary) {
    return (
      <div className="screen">
        <div className="screen-header">
          <div className="logo">✈</div>
          <h1>Saudia Automation</h1>
          <p className="step-label">Step 4 of 4 — Summary</p>
        </div>
        <div className="card">
          <div className="browser-empty">No summary available.</div>
        </div>
        <div className="screen-footer">
          <button className="btn btn-primary" onClick={onNewRun}>Start New Run</button>
        </div>
      </div>
    );
  }

  const { totalProcessed, successCount, noPassportCount, failedCount, failedPnrs, outputPath } = summary;
  const outputFolder = outputPath.replace(/[\\/][^\\/]+$/, '');

  const handleOpenFile = () => window.electronAPI.openPath(outputPath);
  const handleOpenFolder = () => window.electronAPI.openPath(outputFolder);

  return (
    <div className="screen screen-wide">
      <div className="screen-header">
        <div className="logo">✅</div>
        <h1>Automation Complete</h1>
        <p className="step-label">Step 4 of 4 — Summary</p>
      </div>

      {/* Stats */}
      <div className="card">
        <div className="summary-grid">
          <div className="summary-stat">
            <span className="summary-stat-value">{totalProcessed}</span>
            <span className="summary-stat-label">Passengers Written</span>
          </div>
          <div className="summary-stat">
            <span className="summary-stat-value stat-success">{successCount}</span>
            <span className="summary-stat-label">With Passport</span>
          </div>
          <div className="summary-stat">
            <span className="summary-stat-value stat-warn">{noPassportCount}</span>
            <span className="summary-stat-label">No Passport</span>
          </div>
          <div className="summary-stat">
            <span className="summary-stat-value stat-error">{failedCount}</span>
            <span className="summary-stat-label">Failed Tabs</span>
          </div>
        </div>
      </div>

      {/* Output file */}
      <div className="card">
        <div className="file-row">
          <div className="file-info">
            <span className="file-label">Output File</span>
            <span className="file-path path-selected" title={outputPath}>
              {outputPath.split(/[\\/]/).pop()}
            </span>
            <span className="file-full-path">{outputPath}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={handleOpenFile}>
              Open File
            </button>
            <button className="btn btn-outline" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
        </div>
      </div>

      {/* Failed tabs */}
      {failedPnrs.length > 0 && (
        <div className="card">
          <div className="summary-failed-header">
            Failed Tabs ({failedPnrs.length})
          </div>
          <div className="summary-failed-list">
            {failedPnrs.map((url, i) => (
              <div key={i} className="summary-failed-item">{url}</div>
            ))}
          </div>
        </div>
      )}

      <div className="screen-footer">
        <button className="btn btn-primary" onClick={onNewRun}>
          ↺ Start New Run
        </button>
      </div>
    </div>
  );
};

export default Screen4;
