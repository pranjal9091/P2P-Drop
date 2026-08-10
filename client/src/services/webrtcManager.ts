import type { FileMetadata, IceDiagnosticStats, TransferProgress } from '../types/webrtc';
import { calculateSHA256 } from '../utils/crypto';

export interface WebRTCEvents {
  onConnectionStateChange?: (state: RTCIceConnectionState) => void;
  onProgressUpdate?: (progress: TransferProgress) => void;
  onFileReceived?: (file: { blob: Blob; metadata: FileMetadata; checksumVerified: boolean }) => void;
  onDiagnosticsUpdate?: (stats: IceDiagnosticStats) => void;
  onSendComplete?: (metadata: FileMetadata) => void;
  onError?: (error: string) => void;
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

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

  // Configuration thresholds
  private readonly CHUNK_SIZE = 32 * 1024; // 32 KB chunks
  private readonly BUFFER_HIGH_WATERMARK = 1024 * 1024; // 1 MB backpressure pause limit
  private readonly BUFFER_LOW_WATERMARK = 64 * 1024; // 64 KB resume threshold

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

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate.toJSON());
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc) {
        const state = this.pc.iceConnectionState;
        console.log('[WebRTCManager] ICE Connection State:', state);
        if (this.events.onConnectionStateChange) {
          this.events.onConnectionStateChange(state);
        }

        if (state === 'connected') {
          this.startStatsPolling();
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.stopStatsPolling();
        }
      }
    };

    // Receiver handles incoming data channel
    this.pc.ondatachannel = (event) => {
      console.log('[WebRTCManager] Received incoming DataChannel:', event.channel.label);
      this.setupDataChannel(event.channel);
    };

    return this.pc;
  }

  // Sender creates DataChannel explicitly
  public createDataChannel(label = 'p2p-drop-transfer'): RTCDataChannel {
    if (!this.pc) {
      throw new Error('RTCPeerConnection not initialized');
    }
    const channel = this.pc.createDataChannel(label, {
      ordered: true
    });
    this.setupDataChannel(channel);
    return channel;
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = this.BUFFER_LOW_WATERMARK;

    this.dataChannel.onopen = () => {
      console.log('[WebRTCManager] DataChannel opened and ready for transfer');
    };

    this.dataChannel.onclose = () => {
      console.log('[WebRTCManager] DataChannel closed');
    };

    this.dataChannel.onerror = (err) => {
      console.error('[WebRTCManager] DataChannel error:', err);
      if (this.events.onError) {
        this.events.onError('DataChannel error occurred during transfer');
      }
    };

    this.dataChannel.onmessage = (event) => {
      this.handleIncomingMessage(event.data);
    };
  }

  // --- Signaling Offer/Answer & ICE Helpers ---

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('PeerConnection null');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('PeerConnection null');
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.remoteDescriptionSet = true;
    await this.flushPendingIceCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection null');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.remoteDescriptionSet = true;
    await this.flushPendingIceCandidates();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;

    if (!this.remoteDescriptionSet) {
      console.log('[WebRTCManager] Remote description not set yet. Queueing ICE candidate.');
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
    console.log(`[WebRTCManager] Flushing ${this.pendingIceCandidates.length} queued ICE candidates`);
    for (const candidate of this.pendingIceCandidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('[WebRTCManager] Error adding queued ICE candidate:', e);
      }
    }
    this.pendingIceCandidates = [];
  }

  // --- Sender File Transfer Engine with Backpressure ---

  public async sendFile(file: File): Promise<void> {
    if (!this.dataChannel) {
      throw new Error('Data channel is not initialized');
    }

    if (this.dataChannel.readyState !== 'open') {
      console.log('[WebRTCManager] DataChannel state is', this.dataChannel.readyState, '. Waiting for channel to open...');
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

    console.log(`[WebRTCManager] Preparing file transfer: ${file.name} (${file.size} bytes)`);
    
    // Step 1: Pre-transfer Hashing & Metadata Notification
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

    const sha256 = await calculateSHA256(file);
    console.log('[WebRTCManager] SHA-256 Calculated:', sha256);

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

    // Step 3: Stream Chunks with Backpressure Control
    let bytesSent = 0;
    let chunksSent = 0;
    const startTime = Date.now();
    let lastSpeedTime = startTime;
    let lastSpeedBytes = 0;

    for (let offset = 0; offset < file.size; offset += this.CHUNK_SIZE) {
      const slice = file.slice(offset, offset + this.CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      // Check Backpressure
      if (this.dataChannel.bufferedAmount > this.BUFFER_HIGH_WATERMARK) {
        await this.waitForBufferLow();
      }

      this.dataChannel.send(buffer);
      bytesSent += buffer.byteLength;
      chunksSent++;

      // Progress & Speed Calculation
      const now = Date.now();
      const timeDiff = (now - lastSpeedTime) / 1000;
      let speedBps = 0;
      if (timeDiff >= 0.5) {
        speedBps = Math.round((bytesSent - lastSpeedBytes) / timeDiff);
        lastSpeedTime = now;
        lastSpeedBytes = bytesSent;
      }

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

    console.log('[WebRTCManager] File transfer completed successfully');
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

  // --- Receiver Message Handling ---

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

          console.log('[WebRTCManager] Receiver started file stream for:', this.incomingMetadata?.name);
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
        }
      } catch (e) {
        console.error('[WebRTCManager] Failed to parse control message:', e);
      }
    } else if (data instanceof ArrayBuffer) {
      if (!this.incomingMetadata) return;

      this.incomingChunks.push(data);
      this.receivedBytes += data.byteLength;

      const now = Date.now();
      const timeDiff = (now - this.lastSpeedCheckTime) / 1000;
      if (timeDiff >= 0.5) {
        this.currentSpeedBps = Math.round((this.receivedBytes - this.lastSpeedCheckBytes) / timeDiff);
        this.lastSpeedCheckTime = now;
        this.lastSpeedCheckBytes = this.receivedBytes;
      }

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

    const assembledBlob = new Blob(this.incomingChunks, { type: metadata.type });
    this.incomingChunks = [];

    // Step 5: Verify SHA-256 Checksum
    const calculatedHash = await calculateSHA256(assembledBlob);
    const checksumVerified = calculatedHash === metadata.checksumSHA256;
    console.log(`[WebRTCManager] Checksum match: ${checksumVerified}`);

    if (this.events.onProgressUpdate) {
      this.events.onProgressUpdate({
        fileId: metadata.id,
        fileName: metadata.name,
        fileSize: metadata.size,
        bytesTransferred: metadata.size,
        chunksTransferred: metadata.totalChunks,
        totalChunks: metadata.totalChunks,
        speedBps: 0,
        percentage: 100,
        checksumVerified,
        status: 'completed'
      });
    }

    if (this.events.onFileReceived) {
      this.events.onFileReceived({
        blob: assembledBlob,
        metadata,
        checksumVerified
      });
    }

    this.incomingMetadata = null;
  }

  // --- Diagnostics Polling via pc.getStats() ---

  private startStatsPolling() {
    this.stopStatsPolling();
    this.statsInterval = window.setInterval(async () => {
      if (!this.pc || !this.events.onDiagnosticsUpdate) return;

      try {
        const statsReport = await this.pc.getStats();
        let activePairLocalCandidateId = '';
        let activePairRemoteCandidateId = '';
        let currentRttMs: number | undefined = undefined;
        let bytesSent = 0;
        let bytesReceived = 0;

        const candidateMap = new Map<string, any>();

        statsReport.forEach((report) => {
          if (report.type === 'candidate-pair' && (report.nominated || report.state === 'succeeded')) {
            activePairLocalCandidateId = report.localCandidateId;
            activePairRemoteCandidateId = report.remoteCandidateId;
            if (report.currentRoundTripTime !== undefined) {
              currentRttMs = Math.round(report.currentRoundTripTime * 1000);
            }
          }
          if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
            candidateMap.set(report.id, report);
          }
          if (report.type === 'transport') {
            bytesSent = report.bytesSent || 0;
            bytesReceived = report.bytesReceived || 0;
          }
        });

        const localCand = candidateMap.get(activePairLocalCandidateId);
        const remoteCand = candidateMap.get(activePairRemoteCandidateId);

        const diagnosticStats: IceDiagnosticStats = {
          iceConnectionState: this.pc.iceConnectionState,
          iceGatheringState: this.pc.iceGatheringState,
          signalingState: this.pc.signalingState,
          localCandidateType: localCand?.candidateType || 'unknown',
          remoteCandidateType: remoteCand?.candidateType || 'unknown',
          localIpProtocol: localCand?.protocol || 'udp',
          currentRttMs,
          bytesSent,
          bytesReceived,
          throughputBps: this.currentSpeedBps
        };

        this.events.onDiagnosticsUpdate(diagnosticStats);
      } catch (err) {
        console.error('[WebRTCManager] Error polling WebRTC stats:', err);
      }
    }, 1000);
  }

  private stopStatsPolling() {
    if (this.statsInterval !== null) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  public close() {
    this.stopStatsPolling();
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
