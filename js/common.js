/* Shared helpers for the Open Battery Information web app. */
(function () {
  "use strict";

  const OBI = (window.OBI = window.OBI || {});
  OBI.modules = {};
  OBI.interfaces = {};

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const hexByte = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");

  const hexDump = (bytes) => Array.from(bytes, hexByte).join(" ");

  function debugLine(text, cls) {
    const el = document.getElementById("debug-text");
    if (!el) return;
    const span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text + "\n";
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }

  const debug = {
    send: (text) => debugLine(text, "dbg-send"),
    recv: (text) => debugLine(text, "dbg-recv"),
    info: (text) => debugLine(text, "dbg-info"),
    error: (text) => debugLine(text, "dbg-error"),
  };

  /* ---- Simple modal ---- */
  function modal(title, message, kind, okLabel) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        "<h3></h3><p></p><div class='modal-actions'>" +
        "<button class='primary'>" + (okLabel || "OK") + "</button>" +
        "</div></div>";
      overlay.querySelector("h3").textContent = title;
      overlay.querySelector("p").textContent = message;
      const close = () => {
        overlay.remove();
        resolve();
      };
      overlay.querySelector("button").addEventListener("click", close);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
      });
      document.body.appendChild(overlay);
    });
  }

  /* ---- ConnectionError ---- */
  class ConnectionError extends Error {}

  /* ---- Web Serial connection wrapper ----
     Maintains a continuous read loop and a byte queue so that
     "read exactly n bytes" works reliably despite chunking. */
  class SerialConnection {
    constructor(port) {
      this.port = port;
      this.queue = [];
      this.queueLength = 0;
      this.reader = null;
      this.closed = false;
      this.portName = port.getInfo
        ? port.getInfo().usbVendorId + ":" + port.getInfo().usbProductId
        : "unknown";
    }

    async start() {
      this.reader = this.port.readable.getReader();
      this.readLoop = (async () => {
        while (!this.closed) {
          try {
            const { value, done } = await this.reader.read();
            if (done) break;
            this.queue.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            this.queueLength += value.length;
          } catch (err) {
            if (!this.closed) throw err;
            break;
          }
        }
      })().catch((err) => {
        if (!this.closed) OBI.debug && OBI.debug.error("Serial read loop error: " + err.message);
      });
    }

    async read(n, timeoutMs) {
      const start = Date.now();
      while (this.queueLength < n) {
        if (Date.now() - start > timeoutMs) {
          const partial = this.take(Math.min(this.queueLength, n));
          return partial;
        }
        await sleep(10);
      }
      return this.take(n);
    }

    take(n) {
      const out = new Uint8Array(n);
      let offset = 0;
      while (offset < n) {
        const chunk = this.queue[0];
        const take = Math.min(chunk.length, n - offset);
        out.set(chunk.subarray(0, take), offset);
        offset += take;
        if (take === chunk.length) {
          this.queue.shift();
        } else {
          this.queue[0] = chunk.subarray(take);
        }
      }
      this.queueLength -= n;
      return out;
    }

    clear() {
      this.queue = [];
      this.queueLength = 0;
    }

    async write(bytes) {
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(data);
      } finally {
        writer.releaseLock();
      }
    }

    async close() {
      this.closed = true;
      try {
        if (this.reader) {
          await this.reader.cancel();
          this.reader.releaseLock();
        }
        await this.port.close();
      } catch (err) {
        /* already closed */
      }
    }
  }

  OBI.util = {
    sleep,
    hexByte,
    hexDump,
    debug,
    modal,
    ConnectionError,
    SerialConnection,
  };
})();
