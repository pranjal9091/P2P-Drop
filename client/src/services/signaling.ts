import type { SignalingMessage } from '../types/webrtc';

export type SignalingCallback = (msg: SignalingMessage) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: Set<SignalingCallback> = new Set();
  private pingInterval: number | null = null;
  private shouldReconnect = true;
  private currentRoomId: string | null = null;

  constructor(url?: string) {
    if (url) {
      this.url = url;
      return;
    }

    // 1. Environment Variable check (Vite convention: VITE_SIGNALING_URL)
    const envUrl = import.meta.env.VITE_SIGNALING_URL;
    if (envUrl) {
      this.url = envUrl;
      return;
    }

    // 2. Protocol detection (wss: for https pages, ws: for http/localhost)
    const isHttps = window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const port = isHttps ? '' : ':8080';
    
    this.url = `${wsProtocol}//${host}${port}`;
  }

  public async connect(retries = 3, delayMs = 1500): Promise<void> {
    this.shouldReconnect = true;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.attemptConnect();
        return;
      } catch (err) {
        console.warn(`[SignalingClient] Connection attempt ${attempt}/${retries} failed.`);
        if (attempt === retries) throw err;
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }

  private attemptConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[SignalingClient] Connecting to:', this.url);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[SignalingClient] Connected to signaling server at', this.url);
          this.startHeartbeat();
          // If we had an active room before disconnect, auto-rejoin
          if (this.currentRoomId) {
            this.joinRoom(this.currentRoomId);
          }
          resolve();
        };

        this.ws.onerror = (err) => {
          console.error('[SignalingClient] WebSocket error:', err);
          reject(err);
        };

        this.ws.onmessage = (event) => {
          try {
            const data: SignalingMessage = JSON.parse(event.data);
            this.notifyListeners(data);
          } catch (e) {
            console.error('[SignalingClient] Error parsing message:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('[SignalingClient] WebSocket connection closed');
          this.stopHeartbeat();

          if (this.shouldReconnect) {
            setTimeout(() => {
              if (this.shouldReconnect) {
                console.log('[SignalingClient] Attempting auto-reconnect...');
                this.connect(3, 1000).catch((e) => console.warn('[SignalingClient] Auto-reconnect failed:', e));
              }
            }, 2000);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public subscribe(callback: SignalingCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(msg: SignalingMessage) {
    this.listeners.forEach((listener) => listener(msg));
  }

  public send(msg: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[SignalingClient] Cannot send message, WebSocket not open');
    }
  }

  public createRoom() {
    this.send({ type: 'CREATE_ROOM' });
  }

  public joinRoom(roomId: string) {
    this.currentRoomId = roomId;
    this.send({ type: 'JOIN_ROOM', roomId });
  }

  public sendOffer(offer: RTCSessionDescriptionInit) {
    this.send({ type: 'OFFER', offer });
  }

  public sendAnswer(answer: RTCSessionDescriptionInit) {
    this.send({ type: 'ANSWER', answer });
  }

  public sendIceCandidate(candidate: RTCIceCandidateInit) {
    this.send({ type: 'ICE_CANDIDATE', candidate });
  }

  private startHeartbeat() {
    this.pingInterval = window.setInterval(() => {
      this.send({ type: 'PING' });
    }, 12000); // 12s ping interval to prevent cloud proxy timeouts
  }

  private stopHeartbeat() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public disconnect() {
    this.shouldReconnect = false;
    this.currentRoomId = null;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
