import type { AutomationSummary } from './screens/Screen3';

export {};

interface ProgressUpdate {
  current: number;
  total: number;
  currentPnr: string;
}

declare global {
  interface Window {
    electronAPI: {
      // Dialogs
      openFile: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>;
      openFolder: () => Promise<string | null>;

      // Browser
      detectBrowsers: () => Promise<{ name: string; executablePath: string; icon: string; userDataDir: string }[]>;
      connectBrowser: (port: number) => Promise<{ success: boolean; tabCount: number; error?: string }>;

      // Full automation
      startAutomation: (config: {
        excelTemplatePath: string;
        outputFolderPath: string;
        fileCode: string;
      }) => Promise<{ success: boolean }>;
      pauseAutomation:  () => void;
      resumeAutomation: () => void;
      stopAutomation:   () => void;

      // Shell
      openPath: (filePath: string) => Promise<void>;

      // Event listeners
      onLog:      (cb: (message: string) => void)       => (() => void);
      onProgress: (cb: (update: ProgressUpdate) => void) => (() => void);
      onDone:     (cb: (summary: AutomationSummary) => void) => (() => void);
    };
  }
}
