import { MAX_PER_IP, startServer } from './server.js';

const server = await startServer({
  port: Number(process.env.PORT) || 3303,
  maxPerIp: Number(process.env.MAX_PER_IP) || MAX_PER_IP,
});
console.log(`octobot server listening on 127.0.0.1:${server.port}`);
const stop = () => server.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
