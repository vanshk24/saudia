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
    // Exclude playwright browser downloads — we use the user's Chrome via CDP.
    // NOTE: do NOT exclude lib/server/registry/** — server/index.js does
    // require('./registry') and needs that source. Only the actual browser
    // binaries live in .local-browsers, so excluding that alone is enough.
    '!node_modules/playwright-core/.local-browsers/**',
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
