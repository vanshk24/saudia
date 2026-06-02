import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { readWordFile } from '../automation/readWord';
import { groupPassengers } from '../automation/groupPassengers';
import { readBookingList } from '../automation/readBookingList';
import { detectBrowsers } from './browserDetect';
import { connectToBrowser } from '../automation/browserManager';
import {
  runAutomation,
  requestPause,
  requestResume,
  requestStop,
} from '../automation/runAutomation';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Saudia Automation',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Dialog handlers ───────────────────────────────────────────────────────────

ipcMain.handle(
  'dialog:openFile',
  async (_event, filters: { name: string; extensions: string[] }[]) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters,
    });
    return result.canceled ? null : result.filePaths[0];
  }
);

ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── Word parsing ──────────────────────────────────────────────────────────────

ipcMain.handle('word:parse', async (_event, filePath: string) => {
  const passengers = await readWordFile(filePath);
  return groupPassengers(passengers);
});

// ── Booking list parsing (PNR + surname, deduped) ─────────────────────────────

ipcMain.handle('bookinglist:parse', async (_event, filePath: string) => {
  return readBookingList(filePath);
});

// ── Browser detection ─────────────────────────────────────────────────────────

ipcMain.handle('browser:detect', () => detectBrowsers());

// ── Connect to running Chrome via CDP ─────────────────────────────────────────

ipcMain.handle('browser:connect', async (_event, port: number = 9222) => {
  try {
    const { total, saudia } = await connectToBrowser(port);
    return { success: true, tabCount: total, saudiaCount: saudia };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = message.includes('ECONNREFUSED')
      ? ` Make sure Chrome is running with --remote-debugging-port=${port}.`
      : '';
    return { success: false, tabCount: 0, saudiaCount: 0, error: message + hint };
  }
});

// ── Full automation run ───────────────────────────────────────────────────────

ipcMain.handle(
  'automation:start',
  async (event, config: {
    excelTemplatePath: string;
    outputFolderPath: string;
    fileCode: string;
    bookingListPath?: string | null;
  }) => {
    const send = (channel: string, data?: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data);
    };

    // Fire and forget — progress comes via events
    runAutomation(
      config,
      (msg) => send('automation:log', msg),
      (progress) => send('automation:progress', progress),
      (summary) => send('automation:done', summary)
    ).catch(err => {
      send('automation:log', `FATAL: ${err instanceof Error ? err.message : String(err)}`);
    });

    return { success: true };
  }
);

ipcMain.on('automation:pause',  () => requestPause());
ipcMain.on('automation:resume', () => requestResume());
ipcMain.on('automation:stop',   () => requestStop());

// ── Open a file/folder in the OS default app ──────────────────────────────────

ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
  await shell.openPath(filePath);
});
