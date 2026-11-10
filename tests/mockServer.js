const http = require('http');

/**
 * Local mock customer endpoint.
 *   /ok    -> 200
 *   /fail  -> 500
 *   /slow  -> waits 1500ms before answering (to trigger timeouts)
 * Counts hits per path in `hits`.
 */
function startMockServer() {
  const hits = {};
  const bodies = {};
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      hits[req.url] = (hits[req.url] || 0) + 1;
      (bodies[req.url] = bodies[req.url] || []).push(JSON.parse(data || '{}'));
      if (req.url === '/ok') { res.writeHead(200); return res.end('ok'); }
      if (req.url === '/fail') { res.writeHead(500); return res.end('boom'); }
      if (req.url === '/slow') {
        return setTimeout(() => { res.writeHead(200); res.end('late'); }, 1500);
      }
      res.writeHead(404); res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        hits,
        bodies,
        reset: () => {
          for (const k of Object.keys(hits)) delete hits[k];
          for (const k of Object.keys(bodies)) delete bodies[k];
        },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
      });
    });
  });
}

module.exports = { startMockServer };
