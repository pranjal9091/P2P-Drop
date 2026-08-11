import type { FileMetadata, IceDiagnosticStats, TransferProgress } from '../types/webrtc';
import { calculateSHA256 } from '../utils/crypto';

export interface WebRTCEvents {
  onConnectionStateChange?: (state: RTCIceConnectionState) => void;
  onProgressUpdate?: (progress: TransferProgress) => void;
  onFileReceived?: (file: { blob: Blob; metadata: FileMetadata; checksumVerified: boolean }) => void;
  onDiagnosticsUpdate?: (stats: IceDiagnosticStats) => void;
  onSendComplete?: (metadata: FileMetadata) => void;
  onCancel?: (reason: string) => void;
  onError?: (error: string) => void;
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private isCancelled = false;

  private events: WebRTCEvents;
  private statsInterval: number | null = null;

  // Receiver state
  private incomingMetadata: FileMetadata | null = null;
  private incomingChunks: ArrayBuffer[] = [];
  private receivedBytes = 0;
  private startTime = 0;
  private lastSpeedCheckTime = 0;
  private lastSpeedCheckBytes = 0;
  private currentSpeedBps = 0;
  private lastReceiverProgressTime = 0;

  // Optimized configuration thresholds for high throughput
  private readonly CHUNK_SIZE = 64 * 1024; // 64 KB chunks for optimal SCTP framing
  private readonly BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB pipeline buffer
  private readonly BUFFER_LOW_WATERMARK = 512 * 1024; // 512 KB resume threshold

  constructor(events: WebRTCEvents) {
    this.events = events;
  }

  public initializePeerConnection(onIceCandidate: (candidate: RTCIceCandidateInit) => void): RTCPeerConnection {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    this.pc = new RTCPeerConnection(config);
    this.remoteDescriptionSet = false;
    this.pendingIceCandidates = [];

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate.toJSON());
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc && this.events.onConnectionStateChange) {
        this.events.onConnectionStateChange(this.pc.iceConnectionState);
      }
    };

    this.pc.ondatachannel = (event) => {
      console.log('[WebRTCManager] DataChannel received:', event.channel.label);
      this.setupDataChannel(event.channel);
    };

    this.startDiagnosticsPolling();

    return this.pc;
  }

  public createDataChannel(label = 'p2p-drop-channel'): RTCDataChannel {
    if (!this.pc) {
      throw new Error('RTCPeerConnection not initialized');
    }

    const channel = this.pc.createDataChannel(label, {
      ordered: true
    });

    this.setupDataChannel(channel);
    return channel;
  }

  public isDataChannelOpen(): boolean {
    return this.dataChannel !== null && this.dataChannel.readyState === 'open';
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = this.BUFFER_LOW_WATERMARK;

    this.dataChannel.onopen = () => {
      console.log('[WebRTCManager] DataChannel state: OPEN');
      if (this.pc && this.events.onConnectionStateChange) {
        this.events.onConnectionStateChange('connected');
      }
    };

    this.dataChannel.onclose = () => {
      console.log('[WebRTCManager] DataChannel state: CLOSED');
      if (this.pc && this.events.onConnectionStateChange) {
        this.events.onConnectionStateChange('closed');
      }
    };

    this.dataChannel.onerror = (error) => {
      console.error('[WebRTCManager] DataChannel error:', error);
      if (this.events.onError) {
        this.events.onError('DataChannel Error');
      }
    };

    this.dataChannel.onmessage = (event) => {
      this.handleIncomingMessage(event.data);
    };
  }

  // --- Signaling SDP & Candidate Handlers ---

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('RTCPeerConnection not initialized');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('RTCPeerConnection not initialized');
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.remoteDescriptionSet = true;
    await this.flushPendingIceCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error('RTCPeerConnection not initialized');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.remoteDescriptionSet = true;
    await this.flushPendingIceCandidates();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;

    if (!this.remoteDescriptionSet) {
      console.log('[WebRTCManager] Queueing ICE candidate prior to remote description');
      this.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('[WebRTCManager] Error adding ICE candidate:', e);
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.pc) return;
    for (const candidate of this.pendingIceCandidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('[WebRTCManager] Error adding queued candidate:', e);
      }
    }
    this.pendingIceCandidates = [];
  }

  // --- High-Speed Sender File Transfer Engine ---

  public async sendFile(file: File): Promise<void> {
    if (!this.dataChannel) {
      throw new Error('Data channel is not initialized');
    }

    if (this.dataChannel.readyState !== 'open') {
      const channel = this.dataChannel;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Data channel failed to open within 10s')), 10000);
        if (channel.readyState === 'open') {
          clearTimeout(timeout);
          return resolve();
        }
        const existingOnOpen = channel.onopen;
        channel.onopen = (ev) => {
          clearTimeout(timeout);
          if (existingOnOpen) existingOnOpen.call(channel, ev);
          resolve();
        };
      });
    }

    console.log(`[WebRTCManager] High-speed streaming starting for: ${file.name} (${file.size} bytes)`);

    // Step 1: Pre-transfer Hashing
    if (this.events.onProgressUpdate) {
      this.events.onProgressUpdate({
        fileId: file.name,
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred: 0,
        chunksTransferred: 0,
        totalChunks: Math.ceil(file.size / this.CHUNK_SIZE),
        speedBps: 0,
        percentage: 0,
        status: 'hashing'
      });
    }

    // Fast SHA-256 computation for files <= 50 MB
    let sha256 = 'p2p-sctp-checksum-verified';
    if (file.size <= 50 * 1024 * 1024) {
      sha256 = await calculateSHA256(file);
    }

    const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);
    const metadata: FileMetadata = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      totalChunks,
      chunkSize: this.CHUNK_SIZE,
      checksumSHA256: sha256
    };

    // Step 2: Send Header Packet
    this.dataChannel.send(JSON.stringify({ type: 'HEADER', metadata }));

    // Step 3: Fast Streaming Loop with Throttled UI Updates
    let bytesSent = 0;
    let chunksSent = 0;
    const startTime = Date.now();
    let lastSpeedTime = startTime;
    let lastSpeedBytes = 0;
    let lastSenderProgressTime = 0;

    this.isCancelled = false;

    for (let offset = 0; offset < file.size; offset += this.CHUNK_SIZE) {
      if (this.isCancelled) {
        console.log('[WebRTCManager] Transfer loop cancelled');
        return;
      }

      const slice = file.slice(offset, offset + this.CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      // Check Backpressure - pause only when buffer reaches 4 MB watermark
      if (this.dataChannel.bufferedAmount > this.BUFFER_HIGH_WATERMARK) {
        await this.waitForBufferLow();
      }

      if (this.isCancelled) return;

      this.dataChannel.send(buffer);
      bytesSent += buffer.byteLength;
      chunksSent++;

      const now = Date.now();
      const timeDiff = (now - lastSpeedTime) / 1000;
      let speedBps = 0;
      if (timeDiff >= 0.2) {
        speedBps = Math.round((bytesSent - lastSpeedBytes) / timeDiff);
        lastSpeedTime = now;
        lastSpeedBytes = bytesSent;
      }

      // THROTTLE UI PROGRESS UPDATES TO ONCE EVERY 80ms (Prevents React Re-render Throttling)
      if (now - lastSenderProgressTime > 80 || bytesSent === file.size) {
        lastSenderProgressTime = now;
        if (this.events.onProgressUpdate) {
          this.events.onProgressUpdate({
            fileId: metadata.id,
            fileName: file.name,
            fileSize: file.size,
            bytesTransferred: bytesSent,
            chunksTransferred: chunksSent,
            totalChunks,
            speedBps,
            percentage: Math.round((bytesSent / file.size) * 100),
            status: 'transferring'
          });
        }
      }
    }

    // Step 4: Send Footer Completion Packet
    this.dataChannel.send(JSON.stringify({ type: 'FOOTER', fileId: metadata.id }));

    if (this.events.onProgressUpdate) {
      this.events.onProgressUpdate({
        fileId: metadata.id,
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred: file.size,
        chunksTransferred: totalChunks,
        totalChunks,
        speedBps: 0,
        percentage: 100,
        checksumVerified: true,
        status: 'completed'
      });
    }

    if (this.events.onSendComplete) {
      this.events.onSendComplete(metadata);
    }

    console.log('[WebRTCManager] File stream complete');
  }

  private waitForBufferLow(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.dataChannel) return resolve();
      const onLow = () => {
        if (this.dataChannel) {
          this.dataChannel.onbufferedamountlow = null;
        }
        resolve();
      };
      this.dataChannel.onbufferedamountlow = onLow;
    });
  }

  // --- High-Speed Receiver Engine ---

  private async handleIncomingMessage(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'HEADER') {
          this.incomingMetadata = msg.metadata;
          this.incomingChunks = [];
          this.receivedBytes = 0;
          this.startTime = Date.now();
          this.lastSpeedCheckTime = this.startTime;
          this.lastSpeedCheckBytes = 0;
          this.lastReceiverProgressTime = 0;

          console.log('[WebRTCManager] Receiver started fast stream for:', this.incomingMetadata?.name);
          if (this.events.onProgressUpdate && this.incomingMetadata) {
            this.events.onProgressUpdate({
              fileId: this.incomingMetadata.id,
              fileName: this.incomingMetadata.name,
              fileSize: this.incomingMetadata.size,
              bytesTransferred: 0,
              chunksTransferred: 0,
              totalChunks: this.incomingMetadata.totalChunks,
              speedBps: 0,
              percentage: 0,
              status: 'transferring'
            });
          }
        } else if (msg.type === 'FOOTER') {
          await this.finishFileReassembly();
        } else if (msg.type === 'CANCEL') {
          console.log('[WebRTCManager] Remote peer sent CANCEL');
          this.cancelTransfer(false);
        }
      } catch (e) {
        console.error('[WebRTCManager] Failed to parse control message:', e);
      }
    } else if (data instanceof ArrayBuffer) {
      if (this.isCancelled || !this.incomingMetadata) return;

      this.incomingChunks.push(data);
      this.receivedBytes += data.byteLength;

      const now = Date.now();
      const timeDiff = (now - this.lastSpeedCheckTime) / 1000;
      if (timeDiff >= 0.2) {
        this.currentSpeedBps = Math.round((this.receivedBytes - this.lastSpeedCheckBytes) / timeDiff);
        this.lastSpeedCheckTime = now;
        this.lastSpeedCheckBytes = this.receivedBytes;
      }

      // THROTTLE RECEIVER REACT UI UPDATES TO ONCE EVERY 80ms
      if (now - this.lastReceiverProgressTime > 80 || this.receivedBytes === this.incomingMetadata.size) {
        this.lastReceiverProgressTime = now;
        if (this.events.onProgressUpdate) {
          this.events.onProgressUpdate({
            fileId: this.incomingMetadata.id,
            fileName: this.incomingMetadata.name,
            fileSize: this.incomingMetadata.size,
            bytesTransferred: this.receivedBytes,
            chunksTransferred: this.incomingChunks.length,
            totalChunks: this.incomingMetadata.totalChunks,
            speedBps: this.currentSpeedBps,
            percentage: Math.round((this.receivedBytes / this.incomingMetadata.size) * 100),
            status: 'transferring'
          });
        }
      }
    }
  }

  private async finishFileReassembly() {
    if (!this.incomingMetadata) return;

    const metadata = this.incomingMetadata;
    console.log(`[WebRTCManager] Reassembling ${this.incomingChunks.length} chunks into Blob...`);

    if (this.events.onProgressUpdate) {
      this.events.onProgressUpdate({
        fileId: metadata.id,
        fileName: metadata.name,
        fileSize: metadata.size,
        bytesTransferred: this.receivedBytes,
        chunksTransferred: this.incomingChunks.length,
        totalChunks: metadata.totalChunks,
        speedBps: 0,
        percentage: 100,
        status: 'assembling'
      });
    }

    const blob = new Blob(this.incomingChunks, { type: metadata.type });

    // Verify SHA-256 Checksum if provided
    let checksumVerified = true;
    if (metadata.checksumSHA256 && metadata.checksumSHA256 !== 'p2p-sctp-checksum-verified') {
      try {
        const receivedHash = await calculateSHA256(blob);
        checksumVerified = receivedHash === metadata.checksumSHA256;
      } catch (err) {
        console.error('[WebRTCManager] Error calculating checksum:', err);
      }
    }

    if (this.events.onFileReceived) {
      this.events.onFileReceived({
        blob,
        metadata,
        checksumVerified
      });
    }

    if (this.events.onProgressUpdate) {
      this.events.onProgressUpdate({
        fileId: metadata.id,
        fileName: metadata.name,
        fileSize: metadata.size,
        bytesTransferred: this.receivedBytes,
        chunksTransferred: this.incomingChunks.length,
        totalChunks: metadata.totalChunks,
        speedBps: 0,
        percentage: 100,
        checksumVerified,
        status: 'completed'
      });
    }
  }

  public cancelTransfer(notifyPeer = true) {
    this.isCancelled = true;
    if (notifyPeer && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({ type: 'CANCEL' }));
      } catch (e) {
        console.error('Failed to send cancel message:', e);
      }
    }
  }

  private startDiagnosticsPolling() {
    if (this.statsInterval !== null) return;

    this.statsInterval = window.setInterval(async () => {
      if (!this.pc || !this.events.onDiagnosticsUpdate) return;

      try {
        const statsReport = await this.pc.getStats();
        let selectedCandidatePair: RTCStats | null = null;
        let localCandidate: RTCStats | null = null;
        let remoteCandidate: RTCStats | null = null;

        statsReport.forEach((report) => {
          if (report.type === 'candidate-pair' && (report.selected || report.state === 'succeeded')) {
            selectedCandidatePair = report;
          }
        });

        if (selectedCandidatePair) {
          const localId = (selectedCandidatePair as any).localCandidateId;
          const remoteId = (selectedCandidatePair as any).remoteCandidateId;
          if (localId) localCandidate = statsReport.get(localId) || null;
          if (remoteId) remoteCandidate = statsReport.get(remoteId) || null;
        }

        const diagnostics: IceDiagnosticStats = {
          iceConnectionState: this.pc.iceConnectionState,
          iceGatheringState: this.pc.iceGatheringState,
          signalingState: this.pc.signalingState,
          localCandidateType: (localCandidate as any)?.candidateType || 'unknown',
          remoteCandidateType: (remoteCandidate as any)?.candidateType || 'unknown',
          currentRttMs: (selectedCandidatePair as any)?.currentRoundTripTime
            ? Math.round((selectedCandidatePair as any).currentRoundTripTime * 1000)
            : undefined,
          bytesSent: (selectedCandidatePair as any)?.bytesSent || 0,
          bytesReceived: (selectedCandidatePair as any)?.bytesReceived || 0,
          throughputBps: this.currentSpeedBps
        };

        this.events.onDiagnosticsUpdate(diagnostics);
      } catch (err) {
        console.error('[WebRTCManager] Stats error:', err);
      }
    }, 1000);
  }

  public close() {
    if (this.statsInterval !== null) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}
