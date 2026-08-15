/* Firmware uploader — single-button wizard.
   Runs AVRDUDE compiled to WebAssembly (from the leaphy-robotics
   avrdude-webassembly package) and talks to the bootloader over Web Serial.

   The wasm serial layer was rewritten (see avrdude.js glue) to talk to the
   port directly on the main thread — no worker, no SharedArrayBuffer, so no
   cross-origin isolation is required. */
import avrdudeModule from "./avrdude.js?v=6";

const $ = (id) => document.getElementById(id);

const els = {
  flashBtn: $("flash-btn"),
  progressBar: $("progress-bar"),
  statusText: $("status-text"),
  spinner: $("spinner"),
  bundledSize: $("bundled-size"),
  hexFile: $("hex-file"),
  firmwareName: $("firmware-name"),
  logOutput: $("log-output"),
  openObiBtn: $("open-obi-btn"),
  boardRadios: document.querySelectorAll('input[name="board"]'),
  fwRadios: document.querySelectorAll('input[name="fw-source"]'),
  flowItems: { 1: $("flow-1"), 2: $("flow-2"), 3: $("flow-3") },
};

const BOARD = {
  uno: {
    kind: "avrdude", part: "atmega328p", programmer: "arduino", baud: 115200,
    image: "uno.hex",
    note: "Uses firmware/uno.hex from this site, built automatically from the ArduinoOBI source.",
  },
  esp32c3: {
    kind: "esptool", image: "esp32.bin",
    note: "Uses firmware/esp32.bin (merged bootloader + partitions + app) built from the ArduinoOBI source for the ESP32-C3.",
  },
};

function selectedBoard() {
  const checked = [...els.boardRadios].find((r) => r.checked);
  return checked ? checked.value : "uno";
}

function updateFirmwareHint() {
  if (hexSource === "local") return;
  els.firmwareName.textContent = BOARD[selectedBoard()].note;
}

let myPort = null; /* user-granted SerialPort (reused across runs) */
let avrdudeModulePromise = null;
let hexSource = "bundled";
let bundledHexText = {};
let avrdudeLogIndex = 0;
let logPollTimer = null;

function appendLog(text, cls) {
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text + "\n";
  els.logOutput.appendChild(span);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function setStatus(text, kind) {
  els.statusText.textContent = text;
  els.statusText.className = "status-text" + (kind ? " " + kind : "");
  els.spinner.hidden = kind !== "busy";
}

function setProgress(pct) {
  els.progressBar.style.width = pct + "%";
}

function resetFlow() {
  for (const k in els.flowItems) {
    els.flowItems[k].classList.remove("active", "done");
  }
  els.flowItems[1].classList.add("active");
}

function markFlow(n, state) {
  const el = els.flowItems[n];
  if (!el) return;
  el.classList.remove("active", "done");
  el.classList.add(state === "done" ? "done" : "active");
}

function portInfo(port) {
  const info = port.getInfo ? port.getInfo() : {};
  const parts = [];
  if (info.usbVendorId) parts.push("VID " + info.usbVendorId.toString(16).padStart(4, "0"));
  if (info.usbProductId) parts.push("PID " + info.usbProductId.toString(16).padStart(4, "0"));
  return parts.length ? parts.join(" ") : "serial device";
}

function hasWebSerial() {
  return "serial" in navigator;
}

/* ---------- AVRDUDE wasm loading ---------- */
function ensureAvrdude() {
  if (!avrdudeModulePromise) {
    appendLog("Loading AVRDUDE WebAssembly…", "l-info");
    avrdudeModulePromise = (async () => {
      const funcs = await avrdudeModule({
        print: (t) => appendLog(t, "l-info"),
        printErr: (t) => appendLog(t, "l-err"),
      });
      window.funcs = funcs;
      return funcs;
    })();
    avrdudeModulePromise.catch(() => {
      avrdudeModulePromise = null;
    });
  }
  return avrdudeModulePromise;
}

function writeWasmFiles(funcs, confText, hexText) {
  try {
    funcs.FS.mkdir("/tmp");
  } catch (e) {
    /* already exists */
  }
  funcs.FS.writeFile("/tmp/avrdude.conf", confText);
  funcs.FS.writeFile("/tmp/firmware.hex", hexText);
}

/* ---------- firmware source ---------- */
async function getFirmware() {
  const board = BOARD[selectedBoard()];
  if (hexSource === "local") {
    const file = els.hexFile.files && els.hexFile.files[0];
    if (!file) {
      throw new Error("No local firmware file selected.");
    }
    if (board.kind === "esptool") {
      return { kind: "bin", data: new Uint8Array(await file.arrayBuffer()) };
    }
    return { kind: "hex", text: await file.text() };
  }
  if (board.kind === "esptool") {
    const res = await fetch("./esp32.bin");
    if (!res.ok) {
      throw new Error(
        "Could not fetch firmware/esp32.bin (" + res.status + "). " +
        "Run the firmware.yml GitHub Actions workflow to build it."
      );
    }
    return { kind: "bin", data: new Uint8Array(await res.arrayBuffer()) };
  }
  if (!bundledHexText[board.image]) {
    const res = await fetch("./" + board.image);
    if (!res.ok) {
      throw new Error(
        "Could not fetch firmware/" + board.image + " (" + res.status + "). " +
        "Run the firmware.yml GitHub Actions workflow to build it."
      );
    }
    bundledHexText[board.image] = await res.text();
  }
  return { kind: "hex", text: bundledHexText[board.image] };
}

async function loadBundledSize() {
  const board = BOARD[selectedBoard()];
  try {
    const res = await fetch("./" + board.image);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      els.bundledSize.textContent = "(" + buf.byteLength.toLocaleString() + " bytes)";
    } else {
      els.bundledSize.textContent = "(missing — build with CI)";
    }
  } catch (e) {
    els.bundledSize.textContent = "(missing — build with CI)";
  }
}

/* ---------- avrdude log polling ---------- */
function startLogPolling() {
  avrdudeLogIndex = 0;
  logPollTimer = setInterval(pollAvrdudeLog, 60);
}

function stopLogPolling() {
  if (logPollTimer) {
    clearInterval(logPollTimer);
    logPollTimer = null;
  }
  pollAvrdudeLog();
}

function pollAvrdudeLog() {
  const arr = window.avrdudeLog || [];
  while (avrdudeLogIndex < arr.length) {
    const line = arr[avrdudeLogIndex++];
    let text = line.replace(/\r/g, "\n");
    const m = text.match(/(\d+)%/);
    if (m) setProgress(parseInt(m[1], 10));
    for (const sub of text.split("\n")) {
      if (!sub) continue;
      const lower = sub.toLowerCase();
      if (lower.includes("error") || lower.includes("fail") || lower.includes("cannot")) {
        appendLog(sub, "l-err");
      } else if (lower.includes("done") || lower.includes("verified") || lower.includes("success")) {
        appendLog(sub, "l-ok");
      } else if (lower.includes("warning")) {
        appendLog(sub, "l-warn");
      } else {
        appendLog(sub, "l-info");
      }
    }
  }
}

/* ---------- port selection ---------- */
async function selectPort() {
  if (!hasWebSerial()) {
    throw new Error(
      "Web Serial is not available in this browser. Use Chrome or Edge on desktop over HTTPS (or localhost)."
    );
  }
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (e) {
    setStatus("Flash cancelled — no port selected.", "err");
    return null;
  }
  myPort = port;
  window.activePort = port;
  appendLog("Port selected: " + portInfo(port), "l-ok");
  return port;
}

/* ---------- flash ---------- */
async function flash() {
  els.flashBtn.disabled = true;
  els.openObiBtn.hidden = true;
  resetFlow();

  try {
    if (!hasWebSerial()) {
      setStatus(
        "Web Serial isn't available in this browser. Use Chrome or Edge on desktop over HTTPS (or localhost).",
        "err"
      );
      appendLog("Web Serial is NOT available in this browser.", "l-err");
      return;
    }
    appendLog("Web Serial is available.", "l-ok");

    /* navigator.serial.requestPort() requires a user gesture, so ask for
       the port first — before any await consumes transient activation. */
    if (!myPort) {
      setStatus("Plug in your board, then click to choose its port…", "busy");
      const port = await selectPort();
      if (!port) return;
    } else {
      window.activePort = myPort;
    }

    markFlow(1, "done");
    markFlow(2, "active");

    const board = BOARD[selectedBoard()];
    setStatus("Loading the flashing engine…", "busy");
    if (board.kind === "esptool") {
      await flashEsp32();
    } else {
      await flashAvrdude(board);
    }
  } catch (e) {
    stopLogPolling();
    setProgress(0);
    setStatus("Flash failed: " + e.message, "err");
    appendLog("Error: " + e.message, "l-err");
    /* The AVRDUDE wasm runtime may have aborted (e.g. exit() on a serial
       error). Reload it so the next attempt starts from a clean state. */
    if (avrdudeModulePromise) {
      avrdudeModulePromise = null;
      window.activePort = null;
      myPort = null;
    }
    /* Close the serial port so it stops reading and releases the connection;
       otherwise a stale port holds the Web Serial connection open and the
       next attempt fails or hangs. */
    closeActiveSerialPort();
  } finally {
    els.flashBtn.disabled = false;
  }
}

async function flashAvrdude(board) {
  const funcs = await ensureAvrdude();

  setStatus("Preparing the firmware image…", "busy");
  const firmware = await getFirmware();
  if (!firmware.text.trim()) throw new Error("The firmware hex file is empty.");
  const confRes = await fetch("./avrdude.conf");
  if (!confRes.ok) throw new Error("Could not fetch avrdude.conf (" + confRes.status + ").");
  const confText = await confRes.text();
  writeWasmFiles(funcs, confText, firmware.text);
  appendLog(
    "Firmware image: " + Math.round(firmware.text.trim().split("\n").length * 17 / 1024) +
      " KB of Intel HEX (" + firmware.text.trim().split("\n").length + " records).",
    "l-info"
  );

  const args = [
    "avrdude",
    "-v",
    "-p", board.part,
    "-c", board.programmer,
    "-C", "/tmp/avrdude.conf",
    "-b", String(board.baud),
    "-D",
    "-P", "/dev/null",
    "-U", "flash:w:/tmp/firmware.hex:i",
  ].join(" ");

  setStatus("Flashing your board — don't unplug it…", "busy");
  window.avrdudeLog = [];
  startLogPolling();

  const startAvrdude = funcs.cwrap("startAvrdude", "number", ["string"]);
  const rc = await withTimeout(startAvrdude(args), 120000);

  stopLogPolling();

  if (rc === 0) {
    setProgress(100);
    markFlow(2, "done");
    markFlow(3, "active");
    setStatus("Done! Your board is now running the OBI firmware.", "ok");
    appendLog("AVRDUDE exited with code 0. The board will now reboot into the OBI firmware.", "l-ok");
    els.openObiBtn.hidden = false;
  } else {
    setProgress(0);
    setStatus("Flash failed (exit code " + rc + "). Open Advanced for the log.", "err");
    appendLog("AVRDUDE exited with code " + rc + ". Check the log above.", "l-err");
  }
}

async function flashEsp32() {
  const { ESPLoader, Transport } = await import("./esptool.js?v=6");
  appendLog("esptool.js loaded.", "l-ok");

  setStatus("Preparing the firmware image…", "busy");
  const firmware = await getFirmware();
  appendLog("Firmware image: " + firmware.data.length.toLocaleString() + " bytes.", "l-info");

  const terminal = {
    clean() {},
    write: (text) => appendLog(text, "l-info"),
    writeLine: (text) => appendLog(text, "l-info"),
    writeRaw: (text) => appendLog(text, "l-info"),
  };

  const esp = new ESPLoader({
    transport: new Transport(myPort),
    baudrate: 115200,
    terminal,
    debugLogging: false,
  });
  let connected = false;
  try {
    setStatus("Connecting to the ESP32-C3 and entering download mode…", "busy");
    await esp.connect("default_reset", 7, true);
    connected = true;
    await esp.runStub();

    setStatus("Flashing your board — don't unplug it…", "busy");
    await esp.writeFlash({
      fileArray: [{ data: firmware.data, address: 0x0 }],
      eraseAll: false,
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      compress: true,
      reportProgress: (fileIndex, bytesSent, totalBytes) => {
        if (totalBytes > 0) setProgress(Math.round((bytesSent / totalBytes) * 100));
      },
    });
    setProgress(100);

    setStatus("Restarting the board…", "busy");
    await esp.after("hard_reset");

    markFlow(2, "done");
    markFlow(3, "active");
    setStatus("Done! Your ESP32-C3 is now running the OBI firmware.", "ok");
    appendLog("Flash complete. The board will now reboot into the OBI firmware.", "l-ok");
    els.openObiBtn.hidden = false;
  } finally {
    if (connected) {
      try {
        await esp.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
  }
}

function closeActiveSerialPort() {
  const port = window.activePort;
  window.activePort = null;
  if (!port) return;
  try {
    if (window.__rxReader) {
      try {
        window.__rxReader.cancel().catch(() => {});
      } catch (e) {
        /* ignore */
      }
      window.__rxReader = null;
    }
    if (window.__rxWriter) {
      try {
        window.__rxWriter.releaseLock();
      } catch (e) {
        /* ignore */
      }
      window.__rxWriter = null;
    }
    if (window.__rxQueue) window.__rxQueue.length = 0;
    if (port.readable || port.writable) port.close().catch(() => {});
  } catch (e) {
    /* ignore */
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out after " + ms / 1000 + "s.")), ms)
    ),
  ]);
}

/* ---------- wiring ---------- */
els.flashBtn.addEventListener("click", flash);

function onBoardChange() {
  for (const o of els.boardRadios) {
    o.closest(".board-option").classList.toggle("selected", o.checked);
  }
  updateFirmwareHint();
  loadBundledSize();
}

for (const option of els.boardRadios) {
  option.addEventListener("change", onBoardChange);
  option.closest(".board-option").addEventListener("click", onBoardChange);
}

for (const radio of els.fwRadios) {
  radio.addEventListener("change", () => {
    hexSource = radio.value;
    els.hexFile.disabled = hexSource !== "local";
    if (hexSource === "bundled") {
      updateFirmwareHint();
    } else {
      els.firmwareName.textContent = "Select a firmware file compiled for the selected board.";
    }
  });
}

els.hexFile.addEventListener("change", () => {
  const f = els.hexFile.files && els.hexFile.files[0];
  els.firmwareName.textContent = f ? "Will flash " + f.name : "";
});

/* ---------- init ---------- */
(async function init() {
  appendLog("Uploader build v6 — direct Web Serial (no worker).", "l-ok");
  if (hasWebSerial()) {
    appendLog("Web Serial is available.", "l-ok");
  } else {
    els.flashBtn.disabled = true;
    setStatus(
      "Web Serial isn't available in this browser. Use Chrome or Edge on desktop over HTTPS (or localhost).",
      "err"
    );
    appendLog("Web Serial is NOT available in this browser.", "l-err");
  }
  loadBundledSize();
})();
