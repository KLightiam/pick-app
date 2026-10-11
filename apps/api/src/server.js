import http from 'node:http';
import { createApp } from './app.js';
import { attachRealtime } from './realtime/socket.js';
import { config } from './config.js';

const server = http.createServer(createApp({ corsOrigin: config.corsOrigin }));
attachRealtime(server, { corsOrigin: config.corsOrigin });

server.listen(config.port, () => {
  console.log(`Pick API listening on http://localhost:${config.port}`);
});
