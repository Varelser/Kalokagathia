#!/usr/bin/env node
/**
 * Monosphere Ableton Link bridge.
 *
 * Browsers cannot speak Ableton Link (a native UDP protocol), so
 * this little Node program sits between the Link session on your
 * machine and the Monosphere app — the same local-bridge pattern as
 * tools/osc-bridge, with the WebSocket server hand-rolled the same
 * way (no dependencies except the Link binding itself):
 *
 *   Ableton Live / any Link app <--Link (UDP)--> [bridge]
 *        [bridge] --WebSocket :8766--> browser (Monosphere)
 *
 * Usage (Node 18+):
 *   cd tools/link-bridge
 *   npm install            # once: fetches the native `abletonlink`
 *   node link-bridge.mjs [--ws 8766]
 *
 * Then in Monosphere: Play tab -> MIDI Control -> Sequence Sync ->
 * source "Ableton Link". The app connects to ws://127.0.0.1:8766
 * (the default) by itself while that source is selected.
 *
 * If the native `abletonlink` module cannot be loaded (not
 * installed, or no prebuilt binary for this platform/Node), the
 * bridge STILL starts its WebSocket server and tells every client
 * {"type":"link-unavailable", ...} so the app can explain, instead
 * of dying with a stack trace.
 *
 * Wire format with the browser is JSON:
 *   bridge -> browser: {"type":"link-state","bpm":120.0,"beat":16.5,
 *                       "phase":0.5,"isPlaying":true,"numPeers":2}
 *   bridge -> browser: {"type":"link-unavailable","reason":"..."}
 *   browser -> bridge: {"type":"set-tempo","bpm":128}
 *                      {"type":"set-playing","isPlaying":true}
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

/* ---------------- WebSocket (minimal RFC 6455 server) ----------------
 * Same hand-rolled implementation as tools/osc-bridge — the bridge
 * needs no `ws` dependency for its own plumbing. */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function wsEncodeText(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function createWsClient(socket, onText) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let cursor = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        cursor = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        len = Number(buffer.readBigUInt64BE(2));
        cursor = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buffer.length < cursor + maskLen + len) return;
      let payload = buffer.subarray(cursor + maskLen, cursor + maskLen + len);
      if (masked) {
        const mask = buffer.subarray(cursor, cursor + 4);
        payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
      }
      buffer = buffer.subarray(cursor + maskLen + len);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.from([0x8a, 0])); // pong
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          onText(Buffer.concat(fragments).toString('utf8'));
          fragments = [];
        }
      }
    }
  });
  return {
    send(text) {
      if (!socket.destroyed) socket.write(wsEncodeText(text));
    },
    close() {
      socket.end();
    },
  };
}

/* ---------------- Ableton Link session ----------------
 * npm `abletonlink` (node-abletonlink): the module itself is the
 * class. Session state lives in properties (bpm / beat / phase /
 * numPeers / isPlaying), startUpdate(ms, cb) ticks a callback with
 * (beat, phase, bpm, playState), and on('tempo'|'numPeers'|
 * 'playState', cb) reports changes. Every touch point below is
 * guarded: if the surface is missing we report link-unavailable
 * rather than crash. */

const QUANTUM = 4; // one bar of 4/4 — phase is reported within this

async function createLinkSession(onUpdate) {
  let AbletonLink;
  try {
    const mod = await import('abletonlink');
    AbletonLink = mod?.default ?? mod;
    if (typeof AbletonLink !== 'function') {
      throw new Error('abletonlink module did not export a constructor');
    }
  } catch (error) {
    throw new Error(
      `abletonlink could not be loaded (${error?.message ?? error}). ` +
        'Run `npm install` in tools/link-bridge/ to build/install it.',
    );
  }

  const link = new AbletonLink();
  try {
    link.isLinkEnable = true;
  } catch {
    if (typeof link.enable === 'function') link.enable();
  }
  // Share start/stop with the session (Link start/stop sync).
  try {
    if (typeof link.enablePlayStateSync === 'function') link.enablePlayStateSync();
    else link.isPlayStateSync = true;
  } catch {
    /* play-state sync is best effort */
  }
  try {
    link.quantum = QUANTUM;
  } catch {
    /* phase then follows the module default */
  }

  const readState = (fromCallback) => {
    const num = (value, fallback = null) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return {
      type: 'link-state',
      bpm: num(link.bpm, fromCallback?.bpm ?? null),
      beat: num(link.beat, fromCallback?.beat ?? null),
      phase: num(link.phase, fromCallback?.phase ?? null),
      isPlaying:
        typeof fromCallback?.playState === 'boolean'
          ? fromCallback.playState
          : Boolean(link.isPlaying),
      numPeers: num(link.numPeers, 0),
    };
  };

  if (typeof link.startUpdate === 'function') {
    // ~30 ms cadence: inside the 25–50 ms broadcast window.
    link.startUpdate(30, (beat, phase, bpm, playState) => {
      onUpdate(readState({ beat, phase, bpm, playState }));
    });
  } else {
    setInterval(() => onUpdate(readState(null)), 40);
  }
  if (typeof link.on === 'function') {
    for (const key of ['tempo', 'numPeers', 'playState']) {
      try {
        link.on(key, () => onUpdate(readState(null)));
      } catch {
        /* event surface optional */
      }
    }
  }

  return {
    readState: () => readState(null),
    setTempo(bpm) {
      if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 20 || bpm > 999) return false;
      try {
        link.bpm = bpm;
        return true;
      } catch {
        return false;
      }
    },
    setPlaying(isPlaying) {
      try {
        if (isPlaying && typeof link.startPlaying === 'function') link.startPlaying();
        else if (!isPlaying && typeof link.stopPlaying === 'function') link.stopPlaying();
        else link.isPlaying = Boolean(isPlaying);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/* ---------------- Bridge ---------------- */

function parseArgs(argv) {
  const opts = { ws: 8766 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ws') opts.ws = Number(argv[++i]);
  }
  return opts;
}

export async function startBridge(opts) {
  const clients = new Set();
  let session = null;
  let unavailableReason = null;

  const broadcast = (payload) => {
    const text = JSON.stringify(payload);
    for (const client of clients) client.send(text);
  };

  try {
    session = await createLinkSession((state) => broadcast(state));
  } catch (error) {
    unavailableReason = error?.message ?? String(error);
    console.error(`[link-bridge] Ableton Link unavailable: ${unavailableReason}`);
    console.error('[link-bridge] The WebSocket server still runs; the app will show this reason.');
  }

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'monosphere-link-bridge',
        linkAvailable: session !== null,
        reason: unavailableReason,
        wsClients: clients.size,
      }),
    );
  });

  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
    );
    if (head && head.length) socket.unshift(head);
    const client = createWsClient(socket, (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || !session) return;
      if (msg.type === 'set-tempo') {
        if (session.setTempo(msg.bpm)) broadcast(session.readState());
      } else if (msg.type === 'set-playing') {
        if (session.setPlaying(msg.isPlaying === true)) broadcast(session.readState());
      }
    });
    clients.add(client);
    // A new client hears the current situation immediately.
    if (session) client.send(JSON.stringify(session.readState()));
    else client.send(JSON.stringify({ type: 'link-unavailable', reason: unavailableReason }));
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  // While Link is unavailable there are no session updates; repeat
  // the explanation periodically so late/reconnecting clients and
  // their status lines stay truthful.
  let unavailableTimer = null;
  if (!session) {
    unavailableTimer = setInterval(() => {
      broadcast({ type: 'link-unavailable', reason: unavailableReason });
    }, 5000);
    unavailableTimer.unref?.();
  }

  server.listen(opts.ws);
  return { server, clients, session, unavailableReason };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  startBridge(opts).then(({ session }) => {
    console.log('Monosphere Ableton Link bridge');
    console.log(`  App : ws://127.0.0.1:${opts.ws}  (Play tab -> MIDI Control -> Sequence Sync -> Ableton Link)`);
    if (session) {
      console.log('  Link: session joined (start Ableton Live or any Link app to see peers).');
    } else {
      console.log('  Link: NOT available — see the message above. To fix:');
      console.log('        cd tools/link-bridge && npm install');
      console.log('        (the native abletonlink module needs a working build toolchain)');
    }
  });
}
