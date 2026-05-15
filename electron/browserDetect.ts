import fs from 'fs';
import os from 'os';
import path from 'path';

export interface DetectedBrowser {
  name: string;
  executablePath: string;
  userDataDir: string; // existing real profile directory
  icon: string;
}

const home = os.homedir();

// Each entry has the exe paths to check AND the real user-data directory
const BROWSER_CANDIDATES: {
  name: string;
  icon: string;
  userDataDir: string;
  paths: string[];
}[] = [
  {
    name: 'Google Chrome',
    icon: 'chrome',
    userDataDir: path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
    paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  },
  {
    name: 'Microsoft Edge',
    icon: 'edge',
    userDataDir: path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
    paths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
  {
    name: 'Brave Browser',
    icon: 'brave',
    userDataDir: path.join(home, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data'),
    paths: [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      path.join(home, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
  },
  {
    name: 'Mozilla Firefox',
    icon: 'firefox',
    // Firefox profile detection is handled separately
    userDataDir: path.join(home, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles'),
    paths: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    ],
  },
];

export function detectBrowsers(): DetectedBrowser[] {
  const found: DetectedBrowser[] = [];

  for (const candidate of BROWSER_CANDIDATES) {
    for (const execPath of candidate.paths) {
      if (fs.existsSync(execPath)) {
        found.push({
          name: candidate.name,
          executablePath: execPath,
          userDataDir: candidate.userDataDir,
          icon: candidate.icon,
        });
        break;
      }
    }
  }

  return found;
}
