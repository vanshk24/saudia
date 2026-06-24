import React from 'react';
import { AppState } from '../App';

// Build-time flag injected by webpack DefinePlugin. When '1', this is the
// extraction-only variant: the Booking List (auto-entry) picker is hidden so
// the app only reads already-open tabs. Auto-entry code is left fully intact.
const EXTRACTION_ONLY = process.env.EXTRACTION_ONLY === '1';

type Props = {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  onNext: () => void;
};

const Screen1: React.FC<Props> = ({ appState, setAppState, onNext }) => {
  const handleSelectExcelTemplate = async () => {
    const filePath = await window.electronAPI.openFile([
      { name: 'Excel Files', extensions: ['xlsx'] },
    ]);
    if (filePath) {
      setAppState(prev => ({ ...prev, excelTemplatePath: filePath }));
    }
  };

  const handleSelectOutputFolder = async () => {
    const folderPath = await window.electronAPI.openFolder();
    if (folderPath) {
      setAppState(prev => ({ ...prev, outputFolderPath: folderPath }));
    }
  };

  const handleSelectBookingList = async () => {
    const filePath = await window.electronAPI.openFile([
      { name: 'Booking List', extensions: ['xlsx', 'csv'] },
    ]);
    if (!filePath) return;
    setAppState(prev => ({ ...prev, bookingListPath: filePath, bookingCount: 0 }));
    try {
      const entries = await window.electronAPI.parseBookingList(filePath);
      setAppState(prev => ({ ...prev, bookingCount: entries.length }));
    } catch {
      setAppState(prev => ({ ...prev, bookingCount: -1 })); // -1 = parse error
    }
  };

  const canProceed =
    appState.fileCode.trim().length > 0 &&
    appState.excelTemplatePath !== null &&
    appState.outputFolderPath !== null;

  const basename = (fullPath: string) =>
    fullPath.replace(/\\/g, '/').split('/').pop() ?? fullPath;

  return (
    <div className="screen">
      <div className="screen-header">
        <div className="logo">✈</div>
        <h1>Saudia Automation</h1>
        <p className="step-label">Step 1 of 4 — Select Files</p>
      </div>

      <div className="card">
        {/* File code row */}
        <div className="file-row">
          <div className="file-info">
            <span className="file-label">File Code</span>
            <span className="file-path" style={{ color: '#888', fontSize: '12px' }}>
              This becomes the Excel title and filename (e.g. LPC-SV871-16MAY)
            </span>
          </div>
          <input
            className="code-input"
            type="text"
            placeholder="e.g. LPC-SV871-16MAY"
            value={appState.fileCode}
            onChange={e =>
              setAppState(prev => ({ ...prev, fileCode: e.target.value }))
            }
            spellCheck={false}
          />
        </div>

        <div className="divider" />

        {/* Excel template row */}
        <div className="file-row">
          <div className="file-info">
            <span className="file-label">Excel Template</span>
            <span className={`file-path ${appState.excelTemplatePath ? 'path-selected' : 'path-empty'}`}>
              {appState.excelTemplatePath ? basename(appState.excelTemplatePath) : 'No file selected'}
            </span>
            {appState.excelTemplatePath && (
              <span className="file-full-path" title={appState.excelTemplatePath}>
                {appState.excelTemplatePath}
              </span>
            )}
          </div>
          <button className="btn btn-outline" onClick={handleSelectExcelTemplate}>
            Select .xlsx
          </button>
        </div>

        {!EXTRACTION_ONLY && (
        <>
        <div className="divider" />

        {/* Booking list row (PNR + surname input) */}
        <div className="file-row">
          <div className="file-info">
            <span className="file-label">Booking List (PNR + Last Name)</span>
            <span className={`file-path ${appState.bookingListPath ? 'path-selected' : 'path-empty'}`}>
              {appState.bookingListPath ? basename(appState.bookingListPath) : 'No file selected'}
            </span>
            {appState.bookingListPath && (
              <span className="file-full-path" title={appState.bookingListPath}>
                {appState.bookingListPath}
              </span>
            )}
            {appState.bookingListPath && appState.bookingCount > 0 && (
              <span className="file-path path-selected" style={{ color: '#2e9e5b' }}>
                ✓ {appState.bookingCount} unique PNR{appState.bookingCount !== 1 ? 's' : ''} found —
                open up to {appState.bookingCount} tabs (first N processed)
              </span>
            )}
            {appState.bookingListPath && appState.bookingCount === -1 && (
              <span className="file-path path-empty" style={{ color: '#d9534f' }}>
                ⚠️ Could not read this file — check it has a PNR + Name column
              </span>
            )}
          </div>
          <button className="btn btn-outline" onClick={handleSelectBookingList}>
            Select .xlsx / .csv
          </button>
        </div>
        </>
        )}

        <div className="divider" />

        {/* Output folder row */}
        <div className="file-row">
          <div className="file-info">
            <span className="file-label">Output Folder</span>
            <span className={`file-path ${appState.outputFolderPath ? 'path-selected' : 'path-empty'}`}>
              {appState.outputFolderPath ? basename(appState.outputFolderPath) : 'No folder selected'}
            </span>
            {appState.outputFolderPath && (
              <span className="file-full-path" title={appState.outputFolderPath}>
                {appState.outputFolderPath}
              </span>
            )}
          </div>
          <button className="btn btn-outline" onClick={handleSelectOutputFolder}>
            Select Folder
          </button>
        </div>
      </div>

      <div className="status-bar">
        {canProceed ? (
          <span className="status-ready">✓ All set — ready to continue</span>
        ) : (
          <span className="status-pending">Enter a file code and select the template and output folder</span>
        )}
      </div>

      <div className="screen-footer">
        <button
          className={`btn btn-primary ${canProceed ? '' : 'btn-disabled'}`}
          onClick={onNext}
          disabled={!canProceed}
        >
          Next →
        </button>
      </div>
    </div>
  );
};

export default Screen1;
