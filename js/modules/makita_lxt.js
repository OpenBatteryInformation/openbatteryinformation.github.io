/* Makita LXT module, ported from the Python desktop app (modules/makita_lxt.py).
   The widget renders the results table and function-test buttons; the host
   page drives the reading via readBattery(). */
(function () {
  "use strict";

  const { debug, hexDump, modal, toast, ConnectionError } = OBI.util;

  /* Command definitions (start, len, rsp_len, cmd, data...) */
  const MODEL_CMD = [0x01, 0x02, 0x10, 0xcc, 0xdc, 0x0c];
  const READ_DATA_REQUEST = [0x01, 0x04, 0x1d, 0xcc, 0xd7, 0x00, 0x00, 0xff];
  const TESTMODE_CMD = [0x01, 0x03, 0x09, 0x33, 0xd9, 0x96, 0xa5];
  const LEDS_ON_CMD = [0x01, 0x02, 0x09, 0x33, 0xda, 0x31];
  const LEDS_OFF_CMD = [0x01, 0x02, 0x09, 0x33, 0xda, 0x34];
  const RESET_ERROR_CMD = [0x01, 0x02, 0x09, 0x33, 0xda, 0x04];
  const READ_MSG_CMD = [0x01, 0x02, 0x28, 0x33, 0xaa, 0x00];
  const CLEAR_CMD = [0x01, 0x02, 0x00, 0xcc, 0xf0, 0x00];

  /* Commands specific to the F0513 version */
  const F0513_VCELL_1_CMD = [0x01, 0x01, 0x02, 0xcc, 0x31];
  const F0513_VCELL_2_CMD = [0x01, 0x01, 0x02, 0xcc, 0x32];
  const F0513_VCELL_3_CMD = [0x01, 0x01, 0x02, 0xcc, 0x33];
  const F0513_VCELL_4_CMD = [0x01, 0x01, 0x02, 0xcc, 0x34];
  const F0513_VCELL_5_CMD = [0x01, 0x01, 0x02, 0xcc, 0x35];
  const F0513_TEMP_CMD = [0x01, 0x01, 0x02, 0xcc, 0x52];
  const F0513_MODEL_CMD = [0x01, 0x00, 0x02, 0x31];
  const F0513_VERSION_CMD = [0x01, 0x00, 0x02, 0x32];
  const F0513_TESTMODE_CMD = [0x01, 0x01, 0x00, 0xcc, 0x99];

  const initialData = {
    "Model": "",
    "Charge count*": "",
    "State": "",
    "Status code": "",
    "Pack Voltage": "",
    "Cell 1 Voltage": "",
    "Cell 2 Voltage": "",
    "Cell 3 Voltage": "",
    "Cell 4 Voltage": "",
    "Cell 5 Voltage": "",
    "Cell Voltage Difference": "",
    "Temperature Sensor 1": "",
    "Temperature Sensor 2": "",
    "ROM ID": "",
    "Manufacturing date": "",
    "Battery message": "",
    "Capacity": "",
    "Battery type": "",
  };

  const nibbleSwap = (byte) =>
    (((byte & 0xf0) >> 4) | ((byte & 0x0f) << 4)) & 0xff;

  const u16le = (bytes, offset) =>
    (bytes[offset] | (bytes[offset + 1] << 8)) & 0xffff;

  function createWidget(container) {
    container.innerHTML =
      '<div class="test-grid">' +
      "<fieldset class='test-group'><legend>Function test</legend>" +
      '<button data-action="led-on" disabled>LED test ON</button>' +
      '<button data-action="led-off" disabled>LED test OFF</button>' +
      "</fieldset>" +
      "<fieldset class='test-group'><legend>Reset battery</legend>" +
      '<button data-action="reset-errors" disabled>Clear errors</button>' +
      '<button data-action="reset-message" disabled>Reset battery message</button>' +
      "</fieldset>" +
      "</div>" +
      '<div class="table-wrap"><table id="data-table">' +
      "<thead><tr><th>Parameter</th><th>Value</th></tr></thead>" +
      "<tbody></tbody></table></div>" +
      '<div class="table-actions">' +
      '<button data-action="copy">Copy</button>' +
      '<button data-action="clear">Clear</button>' +
      "</div>";

    const state = {
      interface: null,
      commandVersion: null,
      batteryPresent: false,
      busy: false,
    };

    const buttons = {
      "led-on": container.querySelector('[data-action="led-on"]'),
      "led-off": container.querySelector('[data-action="led-off"]'),
      "reset-errors": container.querySelector('[data-action="reset-errors"]'),
      "reset-message": container.querySelector('[data-action="reset-message"]'),
    };

    const enableAllButtons = () => {
      for (const key in buttons) buttons[key].disabled = false;
    };

    const tbody = container.querySelector("tbody");
    const rows = {}; /* parameter -> <tr> */

    function insertBatteryData(data) {
      for (const [parameter, value] of Object.entries(data)) {
        let tr = rows[parameter];
        if (tr) {
          tr.querySelector("td.value").textContent = String(value);
        } else {
          tr = document.createElement("tr");
          const tdParam = document.createElement("td");
          tdParam.textContent = parameter;
          const tdValue = document.createElement("td");
          tdValue.className = "value";
          tdValue.textContent = String(value);
          tr.appendChild(tdParam);
          tr.appendChild(tdValue);
          tr.addEventListener("click", () => tr.classList.toggle("selected"));
          tbody.appendChild(tr);
          rows[parameter] = tr;
        }
      }
    }

    const getInterface = () => {
      if (!state.interface) {
        modal(
          "Error",
          "No interface selected. Please select and connect an interface from the sidebar."
        );
        return null;
      }
      return state.interface;
    };

    /* ---- model identification ---- */
    async function getModel() {
      const response = await state.interface.request(MODEL_CMD);
      return String.fromCharCode(...response.slice(2, 9));
    }

    async function getF0513Model() {
      const response = await state.interface.request(F0513_MODEL_CMD);
      await state.interface.request(CLEAR_CMD);
      state.commandVersion = "F0513";
      modal("Limited", "This model only supports diagnostics");
      return (
        "BL" +
        response[2].toString(16).toUpperCase() +
        response[3].toString(16).toUpperCase()
      );
    }

    /* ---- dynamic data ---- */
    async function readDynamicData() {
      let batteryData;
      if (state.commandVersion === "F0513") {
        await state.interface.request(CLEAR_CMD);
        await state.interface.request(CLEAR_CMD);
        const cellCmds = [
          F0513_VCELL_1_CMD,
          F0513_VCELL_2_CMD,
          F0513_VCELL_3_CMD,
          F0513_VCELL_4_CMD,
          F0513_VCELL_5_CMD,
        ];
        const responses = [];
        for (const cmd of cellCmds) {
          responses.push(await state.interface.request(cmd));
        }
        const temp = await state.interface.request(F0513_TEMP_CMD);
        const voltages = responses.map((r) => u16le(r, 2) / 1000);
        const vPack = voltages.reduce((a, b) => a + b, 0);
        const vDiff = Math.round((Math.max(...voltages) - Math.min(...voltages)) * 100) / 100;
        const tCell = u16le(temp, 2) / 100;
        batteryData = {
          "Pack Voltage": vPack,
          "Cell 1 Voltage": voltages[0],
          "Cell 2 Voltage": voltages[1],
          "Cell 3 Voltage": voltages[2],
          "Cell 4 Voltage": voltages[3],
          "Cell 5 Voltage": voltages[4],
          "Cell Voltage Difference": vDiff,
          "Temperature Sensor 1": tCell,
          "Temperature Sensor 2": "",
        };
      } else {
        const response = await state.interface.request(READ_DATA_REQUEST);
        const vPack = u16le(response, 2) / 1000;
        const voltages = [4, 6, 8, 10, 12].map((o) => u16le(response, o) / 1000);
        const vDiff = Math.round((Math.max(...voltages) - Math.min(...voltages)) * 100) / 100;
        const tCell = u16le(response, 16) / 100;
        const tMosfet = u16le(response, 18) / 100;
        batteryData = {
          "Pack Voltage": vPack,
          "Cell 1 Voltage": voltages[0],
          "Cell 2 Voltage": voltages[1],
          "Cell 3 Voltage": voltages[2],
          "Cell 4 Voltage": voltages[3],
          "Cell 5 Voltage": voltages[4],
          "Cell Voltage Difference": vDiff,
          "Temperature Sensor 1": tCell,
          "Temperature Sensor 2": tMosfet,
        };
      }
      return batteryData;
    }

    /* ---- combined read: static info + model + dynamic data ---- */
    async function readBattery() {
      const iface = getInterface();
      if (!iface) return false;
      if (state.busy) return false;
      state.busy = true;
      try {
        /* static info */
        let response;
        try {
          response = await iface.request(READ_MSG_CMD);
        } catch (e) {
          if (e instanceof ConnectionError) {
            modal(
              "Connection Error",
              "Could not communicate with the battery:\n\n" + e.message
            );
          } else {
            modal(
              "Data Error",
              "Received an unexpected response while reading battery info:\n\n" +
                e.name + ": " + e.message
            );
          }
          return false;
        }

        const romId = hexDump(response.slice(2, 10));
        const rawMsg = hexDump(response.slice(10, 42));
        const swapped = [nibbleSwap(response[36]), nibbleSwap(response[37])];
        const chargeCount = (((swapped[0] << 8) | swapped[1]) & 0x0fff) >>> 0;
        const lockNibble = response[30] & 0x0f;
        const errorByte = response[29];
        const lockStatus = lockNibble > 0 ? "LOCKED" : "UNLOCKED";

        const pad2 = (b) => (b & 0xff).toString(10).padStart(2, "0");
        const hex2 = (b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0");
        insertBatteryData({
          "ROM ID": romId,
          "Battery message": rawMsg,
          "Charge count*": chargeCount,
          "State": lockStatus,
          "Status code": hex2(errorByte),
          "Manufacturing date":
            pad2(response[4]) + "/" + pad2(response[3]) + "/20" + pad2(response[2]),
          "Capacity": (nibbleSwap(response[26]) / 10).toFixed(1) + "Ah",
          "Battery type": nibbleSwap(response[21]),
        });
        state.batteryPresent = true;

        /* model identification */
        state.commandVersion = null;
        let model = null;
        let lastException = null;
        for (const command of [getModel, getF0513Model]) {
          try {
            model = await command();
            break;
          } catch (e) {
            lastException = e;
          }
        }
        if (model === null) {
          modal(
            "Unsupported Battery",
            "Battery is present but the model is not supported.\n\nLast error: " +
              (lastException && lastException.message)
          );
          return false;
        }
        insertBatteryData({ Model: model });

        /* dynamic data */
        try {
          const batteryData = await readDynamicData();
          insertBatteryData(batteryData);
        } catch (e) {
          if (e instanceof ConnectionError) {
            modal(
              "Connection Error",
              "Lost communication while reading battery data:\n\n" + e.message
            );
          } else {
            modal(
              "Data Error",
              "Received an unexpected response while reading battery data:\n\n" +
                e.name + ": " + e.message
            );
          }
          return false;
        }

        enableAllButtons();
        return true;
      } finally {
        state.busy = false;
      }
    }

    /* ---- function test ---- */
    async function onAllLedsOnClick() {
      const iface = getInterface();
      if (!iface) return;
      try {
        await iface.request(TESTMODE_CMD);
        await iface.request(LEDS_ON_CMD);
        toast("LED test on — check the battery LEDs");
      } catch (e) {
        modal(
          "Connection Error",
          "Lost communication while turning LEDs on:\n\n" + e.message
        );
      }
    }

    async function onAllLedsOffClick() {
      const iface = getInterface();
      if (!iface) return;
      try {
        if (state.commandVersion === "F0513") {
          await iface.request(F0513_TESTMODE_CMD);
        } else {
          await iface.request(TESTMODE_CMD);
        }
        await iface.request(LEDS_OFF_CMD);
        toast("LED test off");
      } catch (e) {
        modal(
          "Connection Error",
          "Lost communication while turning LEDs off:\n\n" + e.message
        );
      }
    }

    /* ---- reset ---- */
    async function onResetErrorsClick() {
      const iface = getInterface();
      if (!iface) return;
      try {
        await iface.request(TESTMODE_CMD);
        await iface.request(RESET_ERROR_CMD);
        toast("Battery errors cleared");
      } catch (e) {
        modal(
          "Connection Error",
          "Lost communication while resetting errors:\n\n" + e.message
        );
      }
    }

    async function onResetMessageClick() {
      const iface = getInterface();
      if (!iface) return;
      await modal(
        "Not Implemented",
        "This feature is currently under development."
      );
    }

    /* ---- table actions ---- */
    function copyToClipboard() {
      const selected = Array.from(tbody.querySelectorAll("tr.selected"));
      if (!selected.length) {
        modal("No Selection", "No rows selected to copy!");
        return;
      }
      const rowsText = selected
        .map((tr) => {
          const cells = tr.querySelectorAll("td");
          return Array.from(cells)
            .map((td) => td.textContent)
            .join("\t");
        })
        .join("\n");
      navigator.clipboard
        .writeText(rowsText)
        .then(() => toast("Rows copied to clipboard"))
        .catch(() => modal("Error", "Could not access the clipboard."));
    }

    function clearData() {
      insertBatteryData(initialData);
    }

    container
      .querySelector('[data-action="led-on"]')
      .addEventListener("click", onAllLedsOnClick);
    container
      .querySelector('[data-action="led-off"]')
      .addEventListener("click", onAllLedsOffClick);
    container
      .querySelector('[data-action="reset-errors"]')
      .addEventListener("click", onResetErrorsClick);
    container
      .querySelector('[data-action="reset-message"]')
      .addEventListener("click", onResetMessageClick);
    container
      .querySelector('[data-action="copy"]')
      .addEventListener("click", copyToClipboard);
    container
      .querySelector('[data-action="clear"]')
      .addEventListener("click", clearData);

    insertBatteryData(initialData);

    return {
      setInterface(iface) {
        state.interface = iface;
      },
      readBattery,
      destroy() {
        container.innerHTML = "";
      },
    };
  }

  OBI.modules["makita_lxt"] = {
    getDisplayName: () => "Makita LXT",
    createWidget,
  };
})();
