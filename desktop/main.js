/* Open Battery Information — Electron main process.
   Loads the OBI-1 page and provides native serial access through the
   `serialport` package (no browser Web Serial needed). The renderer talks
   to the serial port over IPC via the preload bridge and a small
   navigator.serial shim. Everything stays local; no telemetry. */
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

let SerialPort = null;
try {
  ({ SerialPort } = require('serialport'));
  console.log('[main] serialport loaded');
} catch (err) {
  console.error('[main] serialport failed to load:', err.message);
}

const SITE_DIR = path.join(__dirname, 'site');
const openPorts = new Map(); // port path -> { port, sender }
let pickerPromise = null;

/* ---------- serialport helpers ---------- */

function toPortInfo(p) {
  return {
    path: p.path,
    vendorId: p.vendorId ? parseInt(p.vendorId, 16) : 0,
    productId: p.productId ? parseInt(p.productId, 16) : 0,
    manufacturer: p.manufacturer || '',
    serialNumber: p.serialNumber || '',
  };
}

function openPort(info, baudRate) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort(
      { path: info.path, baudRate: baudRate || 9600 },
      (err) => (err ? reject(err) : resolve(port))
    );
    port.on('error', () => {});
  });
}

/* ---------- IPC: serial ---------- */

ipcMain.handle('serial:list', async () => {
  const list = await SerialPort.list();
  return list.map(toPortInfo);
});

ipcMain.handle('serial:requestPort', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const info = await showPortPicker(win);
  if (!info) throw new Error('NotFoundError: No port selected');
  return info;
});

ipcMain.handle('serial:open', async (event, info, baudRate) => {
  const existing = openPorts.get(info.path);
  if (existing && existing.port.isOpen) return { ok: true };
  const port = await openPort(info, baudRate);
  port.on('data', (buf) => {
    const entry = openPorts.get(info.path);
    if (entry && entry.sender && !entry.sender.isDestroyed()) {
      entry.sender.send('serial:data', info.path, buf);
    }
  });
  port.on('close', () => openPorts.delete(info.path));
  openPorts.set(info.path, { port, sender: event.sender });
  return { ok: true };
});

ipcMain.handle('serial:setSignals', async (_event, info, dtr) => {
  const entry = openPorts.get(info.path);
  if (!entry) throw new Error('Serial port is not open');
  await new Promise((resolve, reject) =>
    entry.port.set({ dtr: !!dtr }, (err) => (err ? reject(err) : resolve()))
  );
  return { ok: true };
});

ipcMain.handle('serial:write', async (_event, info, data) => {
  const entry = openPorts.get(info.path);
  if (!entry) throw new Error('Serial port is not open');
  await new Promise((resolve, reject) =>
    entry.port.write(Buffer.from(data), (err) => (err ? reject(err) : resolve()))
  );
  return { ok: true };
});

ipcMain.handle('serial:close', async (_event, info) => {
  const entry = openPorts.get(info.path);
  if (!entry) return { ok: true };
  openPorts.delete(info.path);
  await new Promise((resolve) => entry.port.close(() => resolve()));
  return { ok: true };
});

/* ---------- serial port picker ---------- */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const PICKER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #1e1f22; color: #e6e6e6; padding: 20px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p.sub { margin: 0 0 16px; color: #9b9b9b; font-size: 13px; }
  .port { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #333; border-radius: 8px; margin-bottom: 8px; cursor: pointer; }
  .port:hover { border-color: #5f9bff; }
  .port input { margin: 0; }
  .path { font-weight: 600; font-family: ui-monospace, monospace; }
  .meta { margin-left: auto; color: #9b9b9b; font-size: 12px; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
  button { padding: 8px 16px; border-radius: 8px; border: 1px solid #333; background: #2a2b2e; color: #e6e6e6; font: inherit; cursor: pointer; }
  button.primary { background: #3d7eff; border-color: #3d7eff; }
  button.primary:disabled { opacity: 0.5; cursor: default; }
  .empty { color: #9b9b9b; padding: 20px 0; text-align: center; }
</style>
</head>
<body>
  <h1>Select a serial port</h1>
  <p class="sub">Choose the Arduino running the OBI firmware.</p>
  <form id="form">__ROWS__</form>
  <div class="actions">
    <button id="cancel" type="button">Cancel</button>
    <button id="connect" class="primary" type="button" disabled>Connect</button>
  </div>
<script>
  const radios = document.querySelectorAll('input[name="port"]');
  const connect = document.getElementById('connect');
  const cancel = document.getElementById('cancel');
  const form = document.getElementById('form');
  form.addEventListener('change', () => { connect.disabled = !document.querySelector('input[name="port"]:checked'); });
  connect.addEventListener('click', () => {
    const sel = document.querySelector('input[name="port"]:checked');
    if (sel) window.picker.select(sel.value);
  });
  cancel.addEventListener('click', () => window.picker.cancel());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.picker.cancel(); });
</script>
</body>
</html>`;

function showPortPicker(parent) {
  if (pickerPromise) return pickerPromise;
  pickerPromise = (async () => {
    let list = [];
    try {
      list = await SerialPort.list();
    } catch (e) {
      list = [];
    }
    if (!list.length) return null;

    return await new Promise((resolve) => {
      const picker = new BrowserWindow({
        parent,
        modal: true,
        width: 540,
        height: 440,
        resizable: false,
        autoHideMenuBar: true,
        title: 'Select a serial port',
        backgroundColor: '#1e1f22',
        webPreferences: {
          preload: path.join(__dirname, 'preload-picker.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      const rows = list
        .map(
          (p) =>
            '<label class="port"><input type="radio" name="port" value="' +
            escapeHtml(p.path) +
            '"><span class="path">' +
            escapeHtml(p.path) +
            '</span><span class="meta">' +
            escapeHtml(
              [p.manufacturer, p.serialNumber ? 'S/N ' + p.serialNumber : '']
                .filter(Boolean)
                .join(' · ')
            ) +
            '</span></label>'
        )
        .join('');

      ipcMain.once('picker:select', (_e, pickedPath) => {
        const info = list.find((p) => p.path === pickedPath);
        if (picker && !picker.isDestroyed()) picker.close();
        resolve(info ? toPortInfo(info) : null);
      });
      ipcMain.once('picker:cancel', () => {
        if (picker && !picker.isDestroyed()) picker.close();
        resolve(null);
      });
      picker.on('closed', () => resolve(null));

      picker.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(PICKER_HTML.replace('__ROWS__', rows))
      );
      picker.once('ready-to-show', () => picker.show());
    });
  })().finally(() => {
    pickerPromise = null;
  });
  return pickerPromise;
}

/* ---------- window ---------- */

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#1e1f22',
    title: 'OBI-1 · Open Battery Information',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', code, desc, url);
  });

  const target = path.join(SITE_DIR, 'obi.html');
  console.log('[main] loading', target);
  win.loadFile(target).then(
    () => console.log('[main] page loaded'),
    (err) => console.error('[main] loadFile failed:', err)
  );
  win.once('ready-to-show', () => {
    console.log('[main] window ready-to-show');
    win.show();
  });
  return win;
}

app.whenReady().then(() => {
  console.log('[main] app ready');
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }
  try {
    createWindow();
    console.log('[main] window created');
  } catch (err) {
    console.error('[main] createWindow failed:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
