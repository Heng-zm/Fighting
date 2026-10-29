/**
 * Socket.IO transport wrapper.
 *
 * All socket traffic funnels through this small event bus so the rest of the
 * client never has to know about reconnect details or latency probes.
 */

export class Network {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
    this.latency = 0;
    this.jitter = 0;
    this.connected = false;
    this.pingTimer = null;
    this.lastPong = 0;
  }

  /**
   * Connect to the server. Safe to call more than once.
   * @returns {Network}
   */
  connect() {
    if (this.socket) return this;

    if (typeof window.io !== 'function') {
      console.error('[network] Socket.IO client was not loaded.');
      this.emitLocal('connect_error', { message: 'Socket.IO client failed to load.' });
      return this;
    }

    this.socket = window.io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 10000,
      autoConnect: true
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.emitLocal('connect', { id: this.socket.id });
      this.sendPing();
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.emitLocal('disconnect', { reason });
    });

    this.socket.on('connect_error', (error) => {
      this.connected = false;
      this.emitLocal('connect_error', { message: error?.message || 'Connection failed.' });
    });

    this.socket.on('pong', (payload = {}) => {
      if (typeof payload.t === 'number') {
        const rtt = Math.max(0, performance.now() - payload.t);
        this.lastPong = rtt;
        if (!this.latency) {
          this.latency = rtt;
        } else {
          this.jitter = this.jitter * 0.8 + Math.abs(rtt - this.latency) * 0.2;
          this.latency = this.latency * 0.72 + rtt * 0.28;
        }
      }
      this.emitLocal('pong', payload);
    });

    this.socket.onAny((event, ...args) => {
      this.emitLocal(event, args[0]);
    });

    this.pingTimer = setInterval(() => {
      if (this.connected) this.sendPing();
    }, 2000);

    return this;
  }

  sendPing() {
    if (!this.socket || !this.connected) return;
    this.socket.emit('ping', { t: performance.now() });
  }

  /**
   * Subscribe to a socket event or a local transport event.
   * @returns {() => void} unsubscribe
   */
  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emitLocal(event, payload) {
    const listeners = this.handlers.get(event);
    if (!listeners) return;
    for (const handler of [...listeners]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[network] Handler for "${event}" failed:`, error);
      }
    }
  }

  emit(event, payload) {
    if (!this.socket || !this.connected) return false;
    this.socket.emit(event, payload);
    return true;
  }

  get ping() {
    return Math.round(this.latency);
  }

  get quality() {
    if (!this.connected) return 'offline';
    if (this.latency < 90) return 'good';
    if (this.latency < 170) return 'mid';
    return 'bad';
  }

  dispose() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket?.disconnect();
    this.socket = null;
    this.handlers.clear();
  }
}
