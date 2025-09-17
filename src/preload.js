const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  getDocumentsPath: () => ipcRenderer.invoke('get-documents-path'),
  appReady: () => ipcRenderer.invoke('app-ready')
});