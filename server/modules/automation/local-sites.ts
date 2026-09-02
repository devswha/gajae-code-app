import net from 'node:net';

const COMMON_DEVELOPMENT_PORTS = [3000, 4173, 5173, 5174, 8000, 8080] as const;

type PortProbe = (port: number) => Promise<boolean>;

function probeLoopbackPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(200, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function discoverLocalDevelopmentUrls(
  excludedPorts: ReadonlySet<number> = new Set(),
  probe: PortProbe = probeLoopbackPort,
): Promise<string[]> {
  const results = await Promise.all(COMMON_DEVELOPMENT_PORTS.map(async (port) => ({
    port,
    open: !excludedPorts.has(port) && await probe(port),
  })));
  return results.filter((result) => result.open).map((result) => `http://localhost:${result.port}`);
}
