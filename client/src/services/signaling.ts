import type { SignalingMessage } from '../types/webrtc';

export type SignalingCallback = (msg: SignalingMessage) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: Set<SignalingCallback> = new Set();
  private pingInterval: number | null = null;

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

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[SignalingClient] Connecting to:', this.url);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[SignalingClient] Connected to signaling server at', this.url);
          this.startHeartbeat();
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
    }, 25000);
  }

  private stopHeartbeat() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
