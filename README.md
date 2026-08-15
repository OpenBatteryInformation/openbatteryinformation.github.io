# Open Battery Information — Web

A web version of the [open-battery-information](https://github.com/mnh-jansson/open-battery-information)
project, hostable entirely on **GitHub Pages**. It provides:

1. **Landing page** (`index.html`) — the project front page: what it does,
   requirements, how to get started, and links to the two tools.
2. **OBI-1** (`obi.html`) — a browser port of the desktop Tkinter app:
   the Makita LXT module with the Arduino OBI interface, talking to the
   Arduino over the **Web Serial API**.
3. **Firmware Uploader** (`firmware/uploader.html`) — flashes the
   Open Battery Information firmware to an **Arduino Uno** straight from the
   browser, using **AVRDUDE compiled to WebAssembly** + Web Serial.

The Arduino firmware is built by the **original repository**
([open-battery-information](https://github.com/mnh-jansson/open-battery-information))
and attached to its GitHub releases. This site simply fetches the latest
binaries — no local toolchain needed.

## Usage

### Requirements

- **Chrome or Edge on desktop** (or any Chromium-based browser).
- HTTPS or `localhost` (Web Serial and SharedArrayBuffer both require a
  secure context). GitHub Pages provides HTTPS automatically.
- A USB-connected Arduino Uno with the optiboot bootloader.

### Flashing the firmware

Open `firmware/uploader.html`:

1. *Board* — pick your board. **Arduino Uno** (default) or **ESP32-C3**
   (SuperMini).
2. *Flash* — plug the board into USB and click **Flash firmware**; choose
   the port when prompted.
   - Arduino boards: AVRDUDE resets the board into its bootloader
     (1200 baud DTR trick), uploads and verifies the flash.
   - ESP32-C3: esptool drives RTS/DTR to enter the ROM bootloader and
     flashes a merged image (bootloader + partitions + app) at offset 0x0.
   When it finishes, the board reboots into the OBI firmware.

> Note: both flashers talk to the bootloader at 115200 baud. The OBI
> firmware itself runs at 9600 baud and is used by OBI-1 tool.

### Using OBI-1 tool

Open `obi.html`:

1. **Connect** — click **Connect** and pick the serial port of the Arduino
   (or ESP32-C3) running the OBI firmware (9600 baud, with an automatic
   board reset on connect).
2. **Read battery** — insert a battery and press **Read battery**.
   The model, cell voltages, temperatures, charge count and status are read
   in one go. LED tests and error reset work on supported batteries.

> **Warning:** This tool talks to battery BMS hardware. Use at your own risk —
> see the upstream project's documentation and the GPL license.

## How it works

- `js/` — OBI-1 tool: a port of the Python
  `OpenBatteryInformation` app (module + interface architecture), wrapped in
  a guided 3-step wizard (`connect → read → results`). `common.js` provides a
  `SerialConnection` wrapper around the Web Serial API with a background
  read loop.
- `firmware/avrdude.js` + `avrdude.wasm` + `avrdude.conf` — AVRDUDE compiled
  to WebAssembly, vendored from the
  [`@leaphy-robotics/avrdude-webassembly`](https://www.npmjs.com/package/@leaphy-robotics/avrdude-webassembly)
  package (a fork of avrdude). The serial layer in `avrdude.js` was rewritten
  to talk to the port directly over Web Serial on the main thread (no worker,
  no SharedArrayBuffer), and performs the Arduino 1200 baud DTR reset, so the
  actual port is picked with `navigator.serial` rather than `-P`.
- `firmware/uno.hex` — the compiled ArduinoOBI firmware for the Uno,
  fetched from the latest upstream GitHub release by the `firmware.yml`
  workflow.
- `firmware/esp32.bin` — a merged ESP32-C3 image (bootloader + partitions +
  app), built upstream from the `esp32-c3-devkitm-1` PlatformIO env and
  fetched the same way.
- `firmware/esptool.js` — Espressif's official
  [`esptool-js`](https://www.npmjs.com/package/esptool-js) (Apache-2.0) for
  flashing ESP32 chips over Web Serial; loaded on demand by the uploader.

## Continuous integration

| Workflow | What it does |
| --- | --- |
| `firmware.yml` | Downloads `uno.hex` + `esp32.bin` from the latest [upstream release](https://github.com/mnh-jansson/open-battery-information/releases) and commits them to `firmware/`. Runs on a schedule and manually via *Actions*. |
| `pages.yml` | Deploys the static site (`index.html`, `obi.html`, `setup.html`, `css`, `js`, `firmware`, `assets`) to GitHub Pages via `actions/deploy-pages`. |

To set up GitHub Pages on your fork: go to **Settings → Pages → Source:
GitHub Actions**.

## Local development

Serve the directory over HTTP (ES modules require a server, not `file://`):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome/Edge. `localhost` counts as a
secure context, so Web Serial works without HTTPS.

## License

The web app is released under the **GPL-3.0** license. AVRDUDE is also GPL — see `firmware/AVRDUDE-COPYING`.
