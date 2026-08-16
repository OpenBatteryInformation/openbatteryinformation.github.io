/* Electron preload — bridges native serial access to the renderer.
   The page's serial-shim.js surfaces this through the navigator.serial API
   the OBI code already uses. */
const { contextBridge, ipcRenderer } = require('electron');

function toInfo(info) {
  return {
    path: info.path,
    vendorId: info.vendorId || 0,
    productId: info.productId || 0,
    manufacturer: info.manufacturer || '',
    serialNumber: info.serialNumber || '',
  };
}

contextBridge.exposeInMainWorld('serialAPI', {
  requestPort: () => ipcRenderer.invoke('serial:requestPort').then(toInfo),
  open: (info, baudRate) => ipcRenderer.invoke('serial:open', toInfo(info), baudRate),
  close: (info) => ipcRenderer.invoke('serial:close', toInfo(info)),
  setSignals: (info, dtr) => ipcRenderer.invoke('serial:setSignals', toInfo(info), dtr),
  write: (info, bytes) => ipcRenderer.invoke('serial:write', toInfo(info), bytes),
  onData: (cb) => {
    const listener = (_e, portPath, data) => cb(portPath, data);
    ipcRenderer.on('serial:data', listener);
    return () => ipcRenderer.removeListener('serial:data', listener);
  },
});
