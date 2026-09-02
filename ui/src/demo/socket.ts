/*
  A stand-in for the live-updates WebSocket. The real provider opens
  /api/companies/:id/events/ws; in the demo that socket opens instantly and
  receives whatever the handlers emit. Any other URL falls through to the real
  WebSocket so nothing else in the app changes.
*/
type Listener = ((this: WebSocket, ev: MessageEvent) => unknown) | null;

const sockets = new Set<DemoSocket>();

class DemoSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = DemoSocket.CONNECTING;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: Listener = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;

  constructor(url: string) {
    super();
    this.url = url;
    sockets.add(this);
    window.setTimeout(() => {
      if (this.readyState !== DemoSocket.CONNECTING) return;
      this.readyState = DemoSocket.OPEN;
      const event = new Event("open");
      this.onopen?.call(this as unknown as WebSocket, event);
      this.dispatchEvent(event);
    }, 30);
  }

  send() {
    // The demo has nothing to receive from the client.
  }

  close(code = 1000, reason = "") {
    if (this.readyState === DemoSocket.CLOSED) return;
    this.readyState = DemoSocket.CLOSED;
    sockets.delete(this);
    const event = new CloseEvent("close", { code, reason, wasClean: true });
    this.onclose?.call(this as unknown as WebSocket, event);
    this.dispatchEvent(event);
  }

  deliver(payload: unknown) {
    if (this.readyState !== DemoSocket.OPEN) return;
    const event = new MessageEvent("message", { data: JSON.stringify(payload) });
    this.onmessage?.call(this as unknown as WebSocket, event);
    this.dispatchEvent(event);
  }
}

export function emitLiveEvent(payload: unknown) {
  for (const socket of sockets) socket.deliver(payload);
}

export function installDemoSocket() {
  const RealWebSocket = window.WebSocket;
  const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const href = String(url);
    if (href.includes("/events/ws")) return new DemoSocket(href);
    return new RealWebSocket(url, protocols);
  } as unknown as typeof WebSocket;
  Patched.prototype = RealWebSocket.prototype;
  Object.assign(Patched, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });
  window.WebSocket = Patched;
}
