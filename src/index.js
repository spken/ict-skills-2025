const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const server = require('./backend/server');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

class LawnmowerApp {
  constructor() {
    this.mainWindow = null;
    this.backendServer = null;
  }

  createWindow() {
    // Create the browser window.
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: true
      },
      icon: path.join(__dirname, 'assets/icon.png'), // Add icon if available
      show: false, // Don't show until ready
      titleBarStyle: 'default'
    });

    // Load the index.html of the app.
    this.mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Show window when ready to prevent visual flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.webContents.openDevTools();
    }

    // Handle window closed
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  async startBackend() {
    try {
      console.log('Starting backend server...');
      this.backendServer = server;
      await this.backendServer.start();
      
      // Wait a bit for server to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('Backend server started successfully');
    } catch (error) {
      console.error('Failed to start backend server:', error);
      // Show error dialog to user
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'Backend Error', 
        'Failed to start the backend server. Please check that MySQL is running with the correct credentials.'
      );
      app.quit();
    }
  }

  async stopBackend() {
    if (this.backendServer) {
      try {
        await this.backendServer.stop();
        console.log('Backend server stopped');
      } catch (error) {
        console.error('Error stopping backend:', error);
      }
    }
  }

  setupIPC() {
    // IPC handlers for communication between renderer and main process
    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
    });

    ipcMain.handle('get-backend-url', () => {
      return 'http://localhost:3001';
    });

    ipcMain.handle('app-ready', () => {
      return true;
    });

    // Handle application data paths
    ipcMain.handle('get-user-data-path', () => {
      return app.getPath('userData');
    });

    ipcMain.handle('get-documents-path', () => {
      return app.getPath('documents');
    });
  }
}

// Create app instance
const lawnmowerApp = new LawnmowerApp();

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  lawnmowerApp.setupIPC();
  
  // Start backend server first
  await lawnmowerApp.startBackend();
  
  // Then create the window
  lawnmowerApp.createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      lawnmowerApp.createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app termination
app.on('before-quit', async (event) => {
  event.preventDefault();
  await lawnmowerApp.stopBackend();
  app.exit();
});

app.on('will-quit', async (event) => {
  event.preventDefault();
  await lawnmowerApp.stopBackend();
  app.exit();
});