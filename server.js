// Placeholder server for parks-passport. Replace with the real app;
// keep the /healthz route, since the deploy workflow checks it.
const http = require('http');

const PORT = Number(process.env.PORT) || 8080;

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>Parks Passport</title><h1>Parks Passport</h1><p>Coming soon.</p>');
});

server.listen(PORT, () => console.log(`parks-passport listening on :${PORT}`));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
