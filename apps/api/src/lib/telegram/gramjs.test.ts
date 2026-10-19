import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The warm-connection pool in the GramJS adapter, tested against a mocked
 * TelegramClient (no network). What matters: consecutive transfers for one
 * account share ONE connection, a failed transfer drops its connection so the
 * retry reconnects, idle connections close, and log-out kills the warm one.
 */

interface MockClient {
  session: string;
  connected: boolean;
  connect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  sendFile: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
}

const clients: MockClient[] = [];
let nextMessageId = 1;
let failNextSend = false;

vi.mock('telegram', () => {
  class TelegramClient {
    connected = false;
    connect = vi.fn(async () => {
      this.connected = true;
    });
    destroy = vi.fn(async () => {
      this.connected = false;
    });
    sendFile = vi.fn(async () => {
      if (failNextSend) {
        failNextSend = false;
        throw new Error('connection reset');
      }
      return { id: nextMessageId++ };
    });
    invoke = vi.fn(async () => ({ ptsCount: 1 }));
    constructor(public session: { value: string }) {
      clients.push(this as unknown as MockClient);
    }
  }
  const Api = {
    InputPeerChannel: class {},
    channels: { DeleteMessages: class {} },
    auth: { LogOut: class {} },
  };
  return { Api, TelegramClient };
});
vi.mock('telegram/sessions/index.js', () => ({
  StringSession: class {
    constructor(public value: string) {}
  },
}));

const { createGramjsGateway } = await import('./gramjs.js');

const channel = { channelId: '1', accessHash: '2' };
const file = (name: string) => ({
  path: `/tmp/${name}`,
  fileName: name,
  fileSize: 10,
  caption: name,
});
const sessionOf = (client: MockClient) => (client.session as unknown as { value: string }).value;

describe('GramJS gateway — warm transfer connections', () => {
  beforeEach(() => {
    clients.length = 0;
    nextMessageId = 1;
    failNextSend = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses one connection for consecutive uploads on the same account', async () => {
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });

    const first = await gateway.uploadFile('session-a', channel, file('a.jpg'));
    const second = await gateway.uploadFile('session-a', channel, file('b.jpg'));
    const third = await gateway.uploadFile('session-a', channel, file('c.jpg'));

    expect(clients).toHaveLength(1);
    expect(clients[0]!.connect).toHaveBeenCalledTimes(1);
    expect([first.reusedConnection, second.reusedConnection, third.reusedConnection]).toEqual([
      false,
      true,
      true,
    ]);
    expect(clients[0]!.destroy).not.toHaveBeenCalled();
    await gateway.close();
  });

  it('keeps accounts on separate connections', async () => {
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });
    await gateway.uploadFile('session-a', channel, file('a.jpg'));
    await gateway.uploadFile('session-b', channel, file('b.jpg'));
    expect(clients.map(sessionOf)).toEqual(['session-a', 'session-b']);
    await gateway.close();
  });

  it('a prewarm opens the connection the next upload then reuses', async () => {
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });
    gateway.prewarm('session-a');
    const result = await gateway.uploadFile('session-a', channel, file('a.jpg'));
    expect(clients).toHaveLength(1);
    expect(clients[0]!.connect).toHaveBeenCalledTimes(1);
    expect(result.reusedConnection).toBe(true);
    await gateway.close();
  });

  it('drops a connection that failed a transfer, so the retry reconnects cleanly', async () => {
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });
    await gateway.uploadFile('session-a', channel, file('a.jpg'));
    failNextSend = true;
    await expect(gateway.uploadFile('session-a', channel, file('b.jpg'))).rejects.toThrow();
    expect(clients[0]!.destroy).toHaveBeenCalledTimes(1);

    const retry = await gateway.uploadFile('session-a', channel, file('b.jpg'));
    expect(clients).toHaveLength(2);
    expect(retry.reusedConnection).toBe(false);
    await gateway.close();
  });

  it('reconnects when a warm connection dropped while idle', async () => {
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });
    await gateway.uploadFile('session-a', channel, file('a.jpg'));
    clients[0]!.connected = false; // socket died between uploads
    const next = await gateway.uploadFile('session-a', channel, file('b.jpg'));
    expect(clients).toHaveLength(2);
    expect(next.reusedConnection).toBe(false);
    await gateway.close();
  });

  it('closes a warm connection after it sits idle', async () => {
    vi.useFakeTimers();
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });
    await gateway.uploadFile('session-a', channel, file('a.jpg'));
    expect(clients[0]!.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(61_000);
    expect(clients[0]!.destroy).toHaveBeenCalledTimes(1);

    await gateway.uploadFile('session-a', channel, file('b.jpg'));
    expect(clients).toHaveLength(2); // a fresh connection after the idle close
  });

  it('message deletes ride the same warm connection as uploads', async () => {
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });
    await gateway.uploadFile('session-a', channel, file('a.jpg'));
    await gateway.deleteMessages('session-a', channel, ['1']);
    await gateway.deleteMessages('session-a', channel, ['2']);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.invoke).toHaveBeenCalledTimes(2);
    await gateway.close();
  });

  it('log-out retires the warm connection for that session', async () => {
    const gateway = createGramjsGateway({ apiId: 1, apiHash: 'h' });
    await gateway.uploadFile('session-a', channel, file('a.jpg'));
    await gateway.logOut('session-a');
    expect(clients[0]!.destroy).toHaveBeenCalled();

    // clients: [0] warm upload connection, [1] the one-off log-out call.
    // The next transfer must open a fresh connection, not ride the dead one.
    const next = await gateway.uploadFile('session-a', channel, file('b.jpg'));
    expect(clients).toHaveLength(3);
    expect(next.reusedConnection).toBe(false);
    expect(clients[0]!.sendFile).toHaveBeenCalledTimes(1);
    expect(clients[2]!.sendFile).toHaveBeenCalledTimes(1);
    await gateway.close();
  });
});
