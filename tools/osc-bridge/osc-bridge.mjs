#!/usr/bin/env node
/**
 * Monosphere OSC bridge — dependency-free.
 *
 * Browsers cannot speak OSC (UDP), so this little Node program sits
 * between your OSC controller and the Monosphere app:
 *
 *   OSC controller --UDP :9000--> [bridge] --WebSocket :8765--> browser
 *   OSC receiver   <--UDP :9001-- [bridge] <--WebSocket :8765-- browser
 *
 * Usage (Node 18+; uses only built-in modules):
 *   node tools/osc-bridge/osc-bridge.mjs [--osc-in 9000] [--osc-out 9001] [--ws 8765]
 *
 * Then in Monosphere: Play tab -> OSC Control -> connect to
 * ws://127.0.0.1:8765 (the default).
 *
 * Wire format with the browser is JSON:
 *   bridge -> browser: {"type":"osc","address":"/fader/1","args":[0.42]}
 *   browser -> bridge: {"type":"send","address":"/out/1","value":0.5}
 *                      (sent on as an OSC float message to the out port)
 */
import dgram from 'node:dgram';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

/* ---------------- OSC codec ---------------- */

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function writeOscString(str) {
  const raw = Buffer.from(str, 'utf8');
  return Buffer.concat([raw, Buffer.alloc(1 + pad4(raw.length + 1))]);
}

function readOscString(buf, offset) {
  const end = buf.indexOf(0, offset);
  if (end === -1) throw new Error('unterminated OSC string');
  return [buf.toString('utf8', offset, end), end + 1 + pad4(end + 1 - offset)];
}

export function encodeOscMessage(address, args = []) {
  let tags = ',';
  const parts = [];
  for (const arg of args) {
    if (typeof arg === 'number' && Number.isInteger(arg) && Math.abs(arg) < 2 ** 31) {
      tags += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(arg, 0);
      parts.push(b);
    } else if (typeof arg === 'number') {
      tags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(arg, 0);
      parts.push(b);
    } else if (typeof arg === 'string') {
      tags += 's';
      parts.push(writeOscString(arg));
    } else if (typeof arg === 'boolean') {
      tags += arg ? 'T' : 'F';
    }
  }
  return Buffer.concat([writeOscString(address), writeOscString(tags), ...parts]);
}

export function decodeOscPacket(buf, offset = 0) {
  const [address, afterAddress] = readOscString(buf, offset);
  if (address === '#bundle') {
    // 8-byte timetag, then size-prefixed elements.
    const messages = [];
    let cursor = afterAddress + 8;
    while (cursor + 4 <= buf.length) {
      const size = buf.readInt32BE(cursor);
      cursor += 4;
      if (size <= 0 || cursor + size > buf.length) break;
      messages.push(...decodeOscPacket(buf.subarray(cursor, cursor + size)));
      cursor += size;
    }
    return messages;
  }
  let cursor = afterAddress;
  let tags = '';
  if (cursor < buf.length && buf[cursor] === 0x2c /* ',' */) {
    [tags, cursor] = readOscString(buf, cursor);
  }
  const args = [];
  for (const tag of tags.slice(1)) {
    if (tag === 'f') {
      args.push(buf.readFloatBE(cursor));
      cursor += 4;
    } else if (tag === 'i') {
      args.push(buf.readInt32BE(cursor));
      cursor += 4;
    } else if (tag === 's') {
      const [value, next] = readOscString(buf, cursor);
      args.push(value);
      cursor = next;
    } else if (tag === 'T') {
      args.push(true);
    } else if (tag === 'F') {
      args.push(false);
    } else if (tag === 'b') {
      const size = buf.readInt32BE(cursor);
      cursor += 4 + size + pad4(size);
    }
    // Unknown tags are skipped without consuming (best effort relay).
  }
  return [{ address, args }];
}

/* ---------------- WebSocket (minimal RFC 6455 server) ---------------- */

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

/* ---------------- Bridge ---------------- */

function parseArgs(argv) {
  const opts = { oscIn: 9000, oscOut: 9001, oscOutHost: '127.0.0.1', ws: 8765 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--osc-in') opts.oscIn = Number(argv[++i]);
    else if (arg === '--osc-out') opts.oscOut = Number(argv[++i]);
    else if (arg === '--osc-out-host') opts.oscOutHost = String(argv[++i]);
    else if (arg === '--ws') opts.ws = Number(argv[++i]);
  }
  return opts;
}

export function startBridge(opts) {
  const clients = new Set();
  const udpIn = dgram.createSocket('udp4');
  const udpOut = dgram.createSocket('udp4');

  udpIn.on('message', (msg) => {
    let decoded;
    try {
      decoded = decodeOscPacket(msg);
    } catch {
      return; // Not an OSC packet; ignore.
    }
    for (const { address, args } of decoded) {
      const text = JSON.stringify({ type: 'osc', address, args });
      for (const client of clients) client.send(text);
    }
  });
  udpIn.bind(opts.oscIn);

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'monosphere-osc-bridge',
        oscInPort: opts.oscIn,
        oscOut: `${opts.oscOutHost}:${opts.oscOut}`,
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
      if (msg && msg.type === 'send' && typeof msg.address === 'string') {
        const args = Array.isArray(msg.args) ? msg.args : [typeof msg.value === 'number' ? msg.value : 0];
        const packet = encodeOscMessage(msg.address, args);
        udpOut.send(packet, opts.oscOut, opts.oscOutHost);
      }
    });
    clients.add(client);
    client.send(JSON.stringify({ type: 'hello', oscInPort: opts.oscIn, oscOutPort: opts.oscOut }));
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  server.listen(opts.ws);
  return { server, udpIn, udpOut, clients };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  startBridge(opts);
  console.log(`Monosphere OSC bridge`);
  console.log(`  OSC in : udp://127.0.0.1:${opts.oscIn}  (controllers send here)`);
  console.log(`  OSC out: udp://${opts.oscOutHost}:${opts.oscOut}`);
  console.log(`  App    : ws://127.0.0.1:${opts.ws}  (Play tab -> OSC Control -> connect)`);
}
