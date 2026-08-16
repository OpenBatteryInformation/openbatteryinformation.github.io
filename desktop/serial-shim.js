/* Desktop-only Web Serial shim.
   In the Electron app, the main process owns the serial port (via the
   `serialport` package) and streams bytes over IPC. This file re-exposes
   that transport through the same navigator.serial API the OBI web code
   uses, so js/common.js and js/interfaces/arduino_obi.js run unchanged. */
(function () {
  "use strict";

  if (!window.serialAPI) return;

  const api = window.serialAPI;

  class DesktopSerialPort {
    constructor(info) {
      this._info = info;
      this._open = false;
      this._stream = null;
      this._controller = null;
      this._queue = [];
      this._unsubscribe = null;
    }

    getInfo() {
      return {
        usbVendorId: this._info.vendorId || 0,
        usbProductId: this._info.productId || 0,
      };
    }

    isOpen() {
      return this._open;
    }

    async open(options) {
      if (this._open) return;
      await api.open(this._info, (options && options.baudRate) || 9600);
      this._open = true;
      this._unsubscribe = api.onData((portPath, buf) => {
        if (portPath !== this._info.path) return;
        const data = new Uint8Array(buf);
        if (this._controller) this._controller.enqueue(data);
        else this._queue.push(data);
      });
    }

    get readable() {
      if (!this._open) throw new Error('InvalidStateError: port not open');
      if (!this._stream) {
        this._stream = new ReadableStream({
          start: (controller) => {
            this._controller = controller;
            for (const chunk of this._queue) controller.enqueue(chunk);
            this._queue = [];
          },
          cancel: () => {
            this._controller = null;
          },
        });
      }
      return this._stream;
    }

    get writable() {
      if (!this._open) throw new Error('InvalidStateError: port not open');
      return new WritableStream({
        write: (chunk) =>
          api.write(
            this._info,
            chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
          ),
      });
    }

    async setSignals(signals) {
      await api.setSignals(this._info, !!(signals && signals.dataTerminalReady));
    }

    async close() {
      await api.close(this._info);
      if (this._unsubscribe) this._unsubscribe();
      this._unsubscribe = null;
      this._open = false;
    }

    async forget() {}
  }

  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    enumerable: true,
    value: {
      getPorts: async () => [],
      requestPort: async () => {
        const info = await api.requestPort();
        return new DesktopSerialPort(info);
      },
    },
  });
})();
