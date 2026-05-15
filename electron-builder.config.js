module.exports = {
  appId: 'com.saudia.automation',
  productName: 'Saudia Automation',
  copyright: 'Copyright © 2025',

  directories: {
    output: 'release',
  },

  // Files to include in the package
  files: [
    'dist/**/*',
    'package.json',
    'node_modules/**/*',
    // Exclude playwright browser downloads — we use the user's Chrome via CDP
    '!node_modules/playwright-core/.local-browsers/**',
    '!node_modules/playwright-core/lib/server/registry/**',
    '!**/*.map',
  ],

  // Unpack playwright-core from asar so native bindings work correctly
  asarUnpack: [
    'node_modules/playwright-core/**/*',
  ],

  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    // icon is optional — remove this line if assets/icon.png doesn't exist
    // icon: 'assets/icon.png',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: null,
    uninstallerIcon: null,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Saudia Automation',
  },

  extraMetadata: {
    main: 'dist/electron/main.js',
  },
};
