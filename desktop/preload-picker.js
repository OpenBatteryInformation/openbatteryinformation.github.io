/* Preload for the serial port picker window. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  select: (portPath) => ipcRenderer.send('picker:select', portPath),
  cancel: () => ipcRenderer.send('picker:cancel'),
});
