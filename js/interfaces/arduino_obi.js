/* Arduino OBI interface, ported from the Python desktop app (interfaces/arduino_obi.py).
   Uses the Web Serial API instead of pyserial. The widget renders the connection
   details (port + firmware version); the host page owns the Connect button and
   calls connect()/disconnect(). */
(function () {
  "use strict";

  const {
    debug,
    hexDump,
    modal,
    sleep,
    ConnectionError,
    SerialConnection,
  } = OBI.util;

  const INTERFACE_VERSION_CMD = [0x01, 0x00, 0x03, 0x01];

  function createWidget(frame, obi, callbacks) {
    const onConnect = (callbacks && callbacks.onConnect) || function () {};

    frame.innerHTML =
      '<div class="iface-details">' +
      '<div class="iface-detail"><span class="label">Serial port</span>' +
      '<div class="value" id="port-name">No port connected</div></div>' +
      '<div class="iface-detail"><span class="label">Firmware version</span>' +
      '<div class="value" id="version-label">-</div></div>' +
      "</div>";

    const portNameEl = frame.querySelector("#port-name");
    const versionLabel = frame.querySelector("#version-label");

    let conn = null; /* SerialConnection */
    let connected = false;

    const setConnected = (v) => {
      connected = v;
      onConnect(v);
    };

    function portName(port) {
      const info = port.getInfo ? port.getInfo() : {};
      const parts = [];
      if (info.usbVendorId) parts.push("VID " + info.usbVendorId.toString(16));
      if (info.usbProductId) parts.push("PID " + info.usbProductId.toString(16));
      return parts.length ? parts.join(" ") : "serial device";
    }

    async function connect(resetBoard) {
      if (!("serial" in navigator)) {
        modal(
          "Unsupported Browser",
          "Web Serial is not available in this browser.\n\n" +
            "Use Chrome or Edge on desktop over HTTPS (or localhost)."
        );
        return;
      }
      let port;
      try {
        port = await navigator.serial.requestPort();
      } catch (e) {
        /* user cancelled */
        return;
      }
      try {
        await port.open({ baudRate: 9600, bufferSize: 255 });
        if (resetBoard) {
          /* Classic Arduino reset: pulse DTR to reboot the board. */
          await port.setSignals({ dataTerminalReady: false });
          await sleep(100);
          await port.setSignals({ dataTerminalReady: true });
        }
        /* Wait for the Uno to boot out of the (opti)bootloader and for
           the OBI firmware to initialise its serial port. */
        await sleep(2000);

        conn = new SerialConnection(port);
        await conn.start();

        portNameEl.textContent = portName(port) + " (9600 baud)";
        setConnected(true);
        debug.info("Opened serial port: " + portNameEl.textContent);

        const version = await getVersion();
        versionLabel.textContent = "Version: " + version;
        debug.info("Arduino OBI interface version " + version);
      } catch (e) {
        try {
          await port.close();
        } catch (err) {
          /* ignore */
        }
        setConnected(false);
        portNameEl.textContent = "No port connected";
        versionLabel.textContent = "-";
        debug.error("Error opening serial port: " + e.message);
        modal(
          "Connection Error",
          "Could not open the serial port:\n\n" +
            e.message +
            "\n\nCheck that the port is not in use by another application."
        );
      }
    }

    async function disconnect() {
      if (conn) {
        await conn.close();
        conn = null;
      }
      setConnected(false);
      versionLabel.textContent = "-";
      portNameEl.textContent = "No port connected";
      debug.info("Closed serial port");
    }

    function isConnected() {
      return connected;
    }

    async function getVersion() {
      const response = await request(INTERFACE_VERSION_CMD, 5);
      return Array.from(response.slice(2)).join(".");
    }

    async function request(requestBytes, maxAttempts = 5) {
      if (!connected || !conn) {
        throw new ConnectionError(
          "Serial port is not open. Please connect to the Arduino first."
        );
      }
      const expectedLength = requestBytes[2] + 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        debug.send(">> " + hexDump(requestBytes.slice(3)));
        try {
          conn.clear();
          await conn.write(requestBytes);
          if (requestBytes[2] === 0) {
            return undefined;
          }
          const response = await conn.read(expectedLength, 3000);
          debug.recv("<< " + hexDump(response.slice(2)));
          if (response.length === 0) {
            throw new Error(
              "No response received from Arduino (expected " +
                expectedLength +
                " bytes). Check that a battery is connected."
            );
          }
          if (response.length !== expectedLength) {
            throw new Error(
              "Incomplete response: received " +
                response.length +
                " bytes, expected " +
                expectedLength +
                ". The battery may not be seated correctly."
            );
          }
          if (Array.from(response.slice(2)).every((b) => b === 0xff)) {
            throw new Error(
              "Invalid response: all bytes are 0xFF. The battery may not be communicating correctly."
            );
          }
          return response;
        } catch (e) {
          if (e instanceof ConnectionError) throw e;
          debug.error(
            "Attempt " + attempt + "/" + maxAttempts + " failed: " + e.message
          );
        }
      }
      throw new ConnectionError(
        "Failed to get a valid response after " +
          maxAttempts +
          " attempts. Ensure the Arduino is connected and a battery is inserted."
      );
    }

    return {
      connect,
      disconnect,
      isConnected,
      request,
    };
  }

  OBI.interfaces["arduino_obi"] = {
    getDisplayName: () => "Arduino OBI",
    createWidget,
  };
})();
