module.exports = {
  appId: 'com.saudia.automation',
  productName: 'Saudia Automation',
  copyright: 'Copyright © 2025',

  directories: {
    output: 'release',
  },

  // Files to include in the package.
  // Do NOT add 'node_modules/**/*' — that forces EVERY dependency (including
  // devDependencies like electron, typescript, webpack, app-builder-bin) into
  // the build and bloats it ~5x (418MB vs 81MB). electron-builder already
  // bundles only the production dependencies listed in package.json
  // automatically, so we just include our compiled output + manifest.
  files: [
    'dist/**/*',
    'package.json',
    // Exclude playwright browser downloads — we use the user's Chrome via CDP.
    // NOTE: do NOT exclude lib/server/registry/** — server/index.js does
    // require('./registry') and needs that source. Only the actual browser
    // binaries live in .local-browsers, so excluding that alone is enough.
    '!node_modules/playwright-core/.local-browsers/**',
    '!**/*.map',
    // Guard: never pack a stray build output that landed under dist/ (a failed
    // run without --config writes dist/win-unpacked/, which would otherwise get
    // swept into the asar and bloat it by ~700MB).
    '!dist/win-unpacked/**',
    '!dist/*.yml',
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
