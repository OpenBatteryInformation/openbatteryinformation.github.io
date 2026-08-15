/* Open Battery Information web app shell — wizard flow.
   Guides the user through: 1. Connect 2. Read battery 3. Results. */
(function () {
  "use strict";

  const { debug } = OBI.util;
  const $ = (id) => document.getElementById(id);

  const els = {
    moduleSelect: $("module-select"),
    interfaceSelect: $("interface-select"),
    resetCheck: $("reset-check"),
    connectBtn: $("connect-btn"),
    ifaceState: $("iface-state"),
    ifaceWidget: $("iface-widget"),
    readBtn: $("read-btn"),
    readHint: $("read-hint"),
    resultsSummary: $("results-summary"),
    readAgainBtn: $("read-again-btn"),
    moduleContent: $("module-content"),
  };

  const stepItems = { 1: $("step-1"), 2: $("step-2"), 3: $("step-3") };
  const panels = { 1: $("panel-connect"), 2: $("panel-read"), 3: $("panel-results") };

  let iface = null; /* interface controller */
  let moduleWidget = null; /* module controller */
  let connected = false;

  /* ---------- stepper ---------- */
  function goToStep(n) {
    for (const [k, el] of Object.entries(panels)) {
      el.classList.toggle("active", Number(k) === n);
    }
    for (const [k, el] of Object.entries(stepItems)) {
      el.classList.toggle("active", Number(k) === n);
      el.classList.toggle("done", Number(k) < n);
    }
  }

  function markStepDone(n) {
    const el = stepItems[n];
    if (el) {
      el.classList.remove("active");
      el.classList.add("done");
    }
  }

  function resetSteps() {
    for (const el of Object.values(stepItems)) {
      el.classList.remove("active", "done");
    }
    for (const el of Object.values(panels)) {
      el.classList.remove("active");
    }
    stepItems[1].classList.add("active");
    panels[1].classList.add("active");
  }

  /* ---------- interface ---------- */
  function handleConnectChange(v) {
    connected = v;
    updateConnectUi();
    if (v) {
      markStepDone(1);
      goToStep(2);
    } else {
      resetSteps();
    }
  }

  function updateConnectUi() {
    els.connectBtn.textContent = connected ? "Disconnect" : "Connect";
    els.connectBtn.classList.toggle("primary", !connected);
    els.ifaceState.textContent = connected ? "Connected" : "Not connected";
    els.ifaceState.className = "badge " + (connected ? "ok" : "");
    els.readBtn.disabled = !connected;
  }

  function setupInterface() {
    const key = els.interfaceSelect.value;
    const ifaceDef = OBI.interfaces[key];
    if (!ifaceDef) return;
    if (iface) {
      iface.disconnect && iface.disconnect();
      iface = null;
    }
    els.ifaceWidget.innerHTML = "";
    iface = ifaceDef.createWidget(els.ifaceWidget, OBI, {
      onConnect: handleConnectChange,
    });
    connected = iface.isConnected();
    updateConnectUi();
  }

  /* ---------- module ---------- */
  function setupModule() {
    const key = els.moduleSelect.value;
    const moduleDef = OBI.modules[key];
    if (!moduleDef) return;
    if (moduleWidget) {
      moduleWidget.destroy();
      moduleWidget = null;
    }
    els.moduleContent.innerHTML = "";
    moduleWidget = moduleDef.createWidget(els.moduleContent);
    if (iface) moduleWidget.setInterface(iface);
  }

  /* ---------- reading ---------- */
  async function doRead() {
    if (!connected || !iface || !moduleWidget) return;
    els.readBtn.disabled = true;
    els.readBtn.textContent = "Reading…";
    els.readHint.textContent = "Talking to the battery — this takes a few seconds…";
    const ok = await moduleWidget.readBattery();
    if (ok) {
      els.readHint.textContent =
        "Battery read successfully. Open the Results step or press Read again to refresh.";
      markStepDone(2);
      els.resultsSummary.textContent =
        "Battery read — details below. Select rows and use Copy, or Read again to refresh.";
      goToStep(3);
    } else {
      els.readHint.textContent =
        "Could not read the battery. Check it is seated correctly and connected, then try again.";
    }
    els.readBtn.textContent = "Read battery";
    els.readBtn.disabled = !connected;
  }

  /* ---------- wiring ---------- */
  els.connectBtn.addEventListener("click", async () => {
    if (!iface) return;
    if (connected) {
      await iface.disconnect();
    } else {
      await iface.connect(els.resetCheck.checked);
    }
  });

  els.readBtn.addEventListener("click", doRead);
  els.readAgainBtn.addEventListener("click", doRead);

  els.moduleSelect.addEventListener("change", () => {
    setupModule();
    resetSteps();
  });

  els.interfaceSelect.addEventListener("change", () => {
    setupInterface();
    setupModule();
    resetSteps();
  });

  /* ---------- init ---------- */
  function init() {
    if (!("serial" in navigator)) {
      debug.error(
        "Web Serial is not available in this browser. Use Chrome or Edge on desktop over HTTPS (or localhost)."
      );
      els.connectBtn.disabled = true;
    }
    const names = Object.keys(OBI.modules).sort();
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = OBI.modules[name].getDisplayName();
      els.moduleSelect.appendChild(opt);
    }
    if (names.length) els.moduleSelect.value = names[0];

    const ifaceNames = Object.keys(OBI.interfaces).sort();
    for (const name of ifaceNames) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = OBI.interfaces[name].getDisplayName();
      els.interfaceSelect.appendChild(opt);
    }
    if (ifaceNames.length) els.interfaceSelect.value = ifaceNames[0];

    setupInterface();
    setupModule();
    resetSteps();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
