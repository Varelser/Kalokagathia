# Monosphere Ableton Link bridge

Browsers cannot speak Ableton Link — Link is a native UDP protocol
and web pages have no access to it. This bridge is the missing wire,
following the same local-bridge pattern as `tools/osc-bridge`: a
small Node program that joins the Link session on your machine and
relays the session state to the browser over WebSocket.

```
Ableton Live / any Link app                Monosphere (browser)
        ^                                        ^
        |  Ableton Link (UDP, LAN)               | WebSocket :8766
        v                                        |
   [ link-bridge.mjs ] ---------------------------
```

## Run it

Needs Node 18 or newer and — once — an install of the native
`abletonlink` module (it compiles with node-gyp, so a working C++
build toolchain may be required):

```sh
cd tools/link-bridge
npm install
node link-bridge.mjs
# options: --ws 8766
```

If `abletonlink` cannot be loaded, the bridge does **not** crash:
the WebSocket server still starts and every client is told
`{"type":"link-unavailable", ...}`, so the app can show the reason
and the install hint instead of failing silently.

## Requirements

- Ableton Live (with Link enabled) or any other Link-enabled app
  running on this machine or on the same local network. With no
  other app running, the bridge still forms its own session of one
  (peers: 0) and the app's sequencer can follow its timeline.
- Start/stop sharing: the bridge enables Link play-state sync, so a
  session-wide Start/Stop (Link 3 start/stop sync) is what moves
  Monosphere. Pressing play inside one app only affects the session
  transport if that app shares it — behaviour follows the session.

## Use it

1. Start the bridge (above).
2. In Monosphere, open the **Play** tab -> **MIDI Control** ->
   **Sequence Sync**.
3. Set the sync source to **Ableton Link**. The app connects to
   `ws://127.0.0.1:8766` by itself while this source is selected
   (auto-reconnect included).
4. Start the Link session transport: the sequence loads its first
   item, then advances one step per selected division (quarter /
   half / bar / 2 bars — the same selector as the MIDI clock sync).
   Stopping the transport stops playback, through the same code
   paths as the on-screen controls.

If the bridge disconnects mid-play, advancing simply stops — the
app never silently falls back to its internal timer. Restart the
bridge and the app reconnects on its own.

Sync preferences (source + division) are saved in the browser
(localStorage), alongside the MIDI assignments — part of your
performance setup, not of any preset or project file. The Link
section is active while the Play tab is open.

## Protocol (JSON over WebSocket :8766)

Bridge -> browser, broadcast on session updates (~30 ms) and on
change:

```json
{"type":"link-state","bpm":120.0,"beat":16.5,"phase":0.5,"isPlaying":true,"numPeers":2}
{"type":"link-unavailable","reason":"abletonlink could not be loaded (...)"}
```

- `bpm` — session tempo. `beat` — session beat timeline (float).
- `phase` — position inside the 4-beat quantum (bar).
- `isPlaying` — shared transport state. `numPeers` — session size
  (0 = this bridge alone).

Browser -> bridge:

```json
{"type":"set-tempo","bpm":128}
{"type":"set-playing","isPlaying":true}
```

Both are forwarded to the Link session when it is available
(tempo is a session-wide proposal, as in any Link app; play-state
is best effort through the binding's play-state controls).
