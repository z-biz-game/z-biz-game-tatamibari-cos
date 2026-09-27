// Electron shell. The game is a browser artefact first — this exists so the same files
// run as a desktop app without a bundler or a build step. No signing identity and no Team ID
// live here on purpose: this shell is unpackaged by design, and a hardcoded identity is how a
// repo ends up failing someone else's build.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1060,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#080B16',
    title: '畳バリ Tatamibari',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ])
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
