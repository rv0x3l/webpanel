import net from 'node:net';

// Bridges a WebSocket (from browser, e.g. noVNC) to a TCP VNC server.
export function bridgeWsToVnc(ws, { host, port }) {
  const tcp = net.connect({ host, port }, () => {
    // connected
  });

  let wsClosed = false;
  let tcpClosed = false;

  tcp.on('data', chunk => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  });
  tcp.on('error', err => {
    if (!wsClosed && ws.readyState === ws.OPEN) ws.close(1011, 'tcp error: ' + err.message);
    tcpClosed = true;
  });
  tcp.on('close', () => {
    tcpClosed = true;
    if (!wsClosed && ws.readyState === ws.OPEN) ws.close();
  });

  ws.on('message', data => {
    if (tcpClosed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    tcp.write(buf);
  });
  ws.on('close', () => {
    wsClosed = true;
    if (!tcpClosed) tcp.destroy();
  });
  ws.on('error', () => {
    wsClosed = true;
    if (!tcpClosed) tcp.destroy();
  });
}
