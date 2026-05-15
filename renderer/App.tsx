import React, { useState } from 'react';
import Screen1 from './screens/Screen1';
import Screen2 from './screens/Screen2';
import Screen3, { AutomationSummary } from './screens/Screen3';
import Screen4 from './screens/Screen4';
import './styles.css';

export type AppState = {
  fileCode: string;
  excelTemplatePath: string | null;
  outputFolderPath: string | null;
  browserConnected: boolean;
  tabCount: number;
  automationSummary: AutomationSummary | null;
  currentScreen: number;
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>({
    fileCode: '',
    excelTemplatePath: null,
    outputFolderPath: null,
    browserConnected: false,
    tabCount: 0,
    automationSummary: null,
    currentScreen: 1,
  });

  const goToScreen = (screen: number) =>
    setAppState(prev => ({ ...prev, currentScreen: screen }));

  return (
    <div className="app-container">
      {appState.currentScreen === 1 && (
        <Screen1
          appState={appState}
          setAppState={setAppState}
          onNext={() => goToScreen(2)}
        />
      )}
      {appState.currentScreen === 2 && (
        <Screen2
          appState={appState}
          setAppState={setAppState}
          onBack={() => goToScreen(1)}
          onNext={() => goToScreen(3)}
        />
      )}
      {appState.currentScreen === 3 && (
        <Screen3
          appState={appState}
          setAppState={setAppState}
          onDone={(summary: AutomationSummary) => {
            setAppState(prev => ({ ...prev, automationSummary: summary }));
            goToScreen(4);
          }}
        />
      )}
      {appState.currentScreen === 4 && (
        <Screen4
          appState={appState}
          onNewRun={() => {
            setAppState(prev => ({
              ...prev,
              fileCode: '',
              excelTemplatePath: null,
              outputFolderPath: null,
              browserConnected: false,
              tabCount: 0,
              automationSummary: null,
              currentScreen: 1,
            }));
          }}
        />
      )}
    </div>
  );
};

export default App;
