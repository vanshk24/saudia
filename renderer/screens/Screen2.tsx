import React, { useEffect, useState } from 'react';
import { AppState } from '../App';

type Props = {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  onBack: () => void;
  onNext: () => void;
};

const PROFILE_DIR = 'C:\\chrome-automation-profile';

const Screen2: React.FC<Props> = ({ appState, setAppState, onBack, onNext }) => {
  const [chromePath, setChromePath] = useState<string>('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const connected = appState.browserConnected;
  const tabCount = appState.tabCount;

  // Detect Chrome path on mount to build the launch command
  useEffect(() => {
    window.electronAPI.detectBrowsers().then(browsers => {
      const chrome = browsers.find(b => b.name === 'Google Chrome');
      if (chrome) setChromePath(chrome.executablePath);
    });
  }, []);

  const chromeCommand = chromePath
    ? `"${chromePath}" --remote-debugging-port=9222 --user-data-dir=${PROFILE_DIR}`
    : '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir=' + PROFILE_DIR;

  const handleCopy = () => {
    navigator.clipboard.writeText(chromeCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);

    const result = await window.electronAPI.connectBrowser();

    if (result.success) {
      setAppState(prev => ({
        ...prev,
        browserConnected: true,
        tabCount: result.tabCount,
      }));
      if (result.tabCount === 0) {
        setConnectError(
          `Connected to Chrome but found 0 tabs. ` +
          `Make sure your Saudia booking tabs are open in the Chrome window ` +
          `launched with --remote-debugging-port=9222 (not your regular Chrome).`
        );
      }
    } else {
      setConnectError(result.error ?? 'Failed to connect to browser.');
    }

    setConnecting(false);
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <div className="logo">✈</div>
        <h1>Saudia Automation</h1>
        <p className="step-label">Step 2 of 4 — Connect Browser</p>
      </div>

      <div className="card">
        <div className="captcha-instructions">

          {/* Step 1 — Launch Chrome */}
          <div className="captcha-step">
            <span className="captcha-num">1</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span>Open a terminal and run this command to launch Chrome:</span>
              <div className="command-box">
                <span className="captcha-url">{chromeCommand}</span>
                <button className="btn btn-outline btn-copy" onClick={handleCopy}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* Step 2 — Open booking tabs */}
          <div className="captcha-step">
            <span className="captcha-num">2</span>
            <span>
              In that Chrome window, open each PNR booking page on the Saudia website.
              Make sure all booking-detail pages are fully loaded.
            </span>
          </div>

          {/* Step 3 — Connect */}
          <div className="captcha-step">
            <span className="captcha-num">3</span>
            <span>
              Once all tabs are open and loaded, click <strong>Connect to Browser</strong> below.
            </span>
          </div>

        </div>

        {/* Error message */}
        {connectError && (
          <div className="launch-error" style={{ margin: '0 24px 16px' }}>
            {connectError}
          </div>
        )}

        {/* Success message */}
        {connected && tabCount > 0 && (
          <div className="launch-success" style={{ margin: '0 24px 16px' }}>
            Connected! Found <strong>{tabCount}</strong> tab{tabCount !== 1 ? 's' : ''} ready to process.
          </div>
        )}
      </div>

      <div className="screen-footer footer-split">
        <button className="btn btn-outline" onClick={onBack} disabled={connecting}>
          ← Back
        </button>

        {!connected || tabCount === 0 ? (
          <button
            className={`btn btn-primary ${connecting ? 'btn-disabled' : ''}`}
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting…' : connected ? 'Reconnect' : 'Connect to Browser'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="btn btn-outline"
              onClick={handleConnect}
              disabled={connecting}
            >
              Reconnect
            </button>
            <button className="btn btn-primary" onClick={onNext}>
              Start Automation →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Screen2;
