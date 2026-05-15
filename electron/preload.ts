import { contextBridge, ipcRenderer } from 'electron';
import type { AutomationSummary, ProgressUpdate } from '../automation/runAutomation';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Dialogs ────────────────────────────────────────────────────────────────
  openFile: (filters: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters),

  openFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFolder'),

  // ── Word parsing ───────────────────────────────────────────────────────────
  parseWordFile: (filePath: string): Promise<import('../automation/groupPassengers').ParseResult> =>
    ipcRenderer.invoke('word:parse', filePath),

  // ── Browser ────────────────────────────────────────────────────────────────
  detectBrowsers: (): Promise<import('./browserDetect').DetectedBrowser[]> =>
    ipcRenderer.invoke('browser:detect'),

  connectBrowser: (): Promise<{ success: boolean; tabCount: number; saudiaCount: number; error?: string }> =>
    ipcRenderer.invoke('browser:connect'),

  // ── Full automation ────────────────────────────────────────────────────────
  startAutomation: (config: {
    excelTemplatePath: string;
    outputFolderPath: string;
    fileCode: string;
  }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('automation:start', config),

  pauseAutomation:  (): void => ipcRenderer.send('automation:pause'),
  resumeAutomation: (): void => ipcRenderer.send('automation:resume'),
  stopAutomation:   (): void => ipcRenderer.send('automation:stop'),

  // ── Shell ──────────────────────────────────────────────────────────────────
  openPath: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:openPath', filePath),

  // ── Event listeners (return unsubscribe fn) ────────────────────────────────
  onLog: (cb: (message: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('automation:log', handler);
    return () => ipcRenderer.removeListener('automation:log', handler);
  },

  onProgress: (cb: (update: ProgressUpdate) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, update: ProgressUpdate) => cb(update);
    ipcRenderer.on('automation:progress', handler);
    return () => ipcRenderer.removeListener('automation:progress', handler);
  },

  onDone: (cb: (summary: AutomationSummary) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, summary: AutomationSummary) => cb(summary);
    ipcRenderer.on('automation:done', handler);
    return () => ipcRenderer.removeListener('automation:done', handler);
  },
});
