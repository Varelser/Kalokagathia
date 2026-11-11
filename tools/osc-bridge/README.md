# Monosphere OSC bridge

Browsers cannot speak OSC — OSC rides on UDP, and web pages have no
UDP access. This bridge is the missing wire: a single dependency-free
Node script that relays OSC <-> WebSocket on your own machine.

```
OSC controller (TouchOSC, Lemur, Max, ...)        Monosphere (browser)
        |  UDP :9000                                       ^
        v                                                  | WebSocket :8765
   [ osc-bridge.mjs ] --------------------------------------
        |
        |  UDP :9001  (messages the app sends out)
        v
OSC receiver (another app, lighting, ...)
```

## Run it

Needs Node 18 or newer (the same Node the launcher uses). No
`npm install` — it uses only Node's built-in modules.

```sh
node tools/osc-bridge/osc-bridge.mjs
# options: --osc-in 9000  --osc-out 9001  --osc-out-host 127.0.0.1  --ws 8765
```

## Use it

1. Start the bridge (above).
2. In Monosphere, open the **Play** tab -> **OSC Control**.
3. Press **ブリッジに接続** (the default address is
   `ws://127.0.0.1:8765`).
4. Pick a target (a macro knob or any parameter), press **Learn**,
   then move a control on your OSC app — the next OSC address that
   arrives is bound to that target.
5. Send values as OSC floats. The first numeric argument is the
   control value: 0..1 is used as-is; larger values are read as a
   0..127 controller scale (TouchOSC-style).

Assignments are saved in the browser (localStorage), like the MIDI
assignments — they are part of your controller setup, not of any
preset or project file. The OSC section is active while the Play
tab is open.

## About Syphon / Spout

Syphon (macOS) and Spout (Windows) share GPU textures between
native apps; a web page cannot originate a Syphon feed — there is
no browser API for it, and this bridge (a network relay) cannot
change that. The practical route is:

1. Run Monosphere fullscreen in the browser.
2. Capture that window with a Syphon server tool (for example
   OBS Studio with a Syphon output, or a window-to-Syphon
   utility).
3. Receive the feed in Resolume / VDMX / TouchDesigner / Max as
   usual.

That capture chain loses nothing visually — the canvas is the same
pixels either way.
