# P2P Drop — Direct Browser-to-Browser File Transfer

> A zero-server file sharing application using native WebRTC DataChannels and a custom WebSocket signaling broker. Stream binary payloads of any size directly between browser memory heaps with zero intermediate storage, zero upload wait, and bit-perfect SHA-256 integrity verification.

![License](https://img.shields.io/badge/license-MIT-amber)
![WebRTC](https://img.shields.io/badge/WebRTC-Native%20DataChannel-4FD1C5)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6)

---

## ⚡ Key Technical Architecture & Interview Highlights

1. **Native WebRTC DataChannel Engine**:
   - Zero third-party WebRTC wrappers (no PeerJS). Built directly against standard browser `RTCPeerConnection` and `RTCDataChannel` APIs.
   - Configured with Google public STUN servers (`stun:stun.l.google.com:19302`) for NAT traversal.
2. **Trickle ICE Candidate Queueing**:
   - Asynchronous candidate buffer queues candidates received prior to `setRemoteDescription()` execution, eliminating `InvalidStateError`.
3. **DataChannel Backpressure Engine**:
   - Files are sliced into 32 KB ArrayBuffer chunks.
   - Monitors `RTCDataChannel.bufferedAmount`. Pauses reading when buffer exceeds 1 MB (`BUFFER_HIGH_WATERMARK`) and resumes upon `onbufferedamountlow` (64 KB).
4. **Cryptographic Integrity (SHA-256)**:
   - Web Crypto API (`crypto.subtle`) pre-computes checksums on sender and verifies assembled payload on receiver.
5. **Real-time Oscilloscope & Telemetry Panel**:
   - HTML5 Canvas oscilloscope waveform dynamically scales amplitude with live throughput (`throughputBps`).
   - Telemetry drawer queries `RTCPeerConnection.getStats()` to display candidate pair types (`HOST`, `SRFLX`, `RELAY`), RTT latency, and DTLS status.

---

## 🎨 "Direct Signal" Aesthetics

- **Dual-Zone Layout**: Local Transmitter (Signal Amber `#E8A33D`) vs Remote Receiver (Signal Teal `#4FD1C5`), connected by a live Canvas connection beam.
- **Typography**: Monospace display (`Space Mono`) for frequency dials and tabular telemetry metrics (`tabular-nums font-mono`).

---

## 🚀 Quickstart Guide

### Prerequisites
- Node.js 18+ and npm

### Installation
```bash
# Clone repository
git clone https://github.com/pranjal9091/P2P-Drop.git
cd P2P-Drop

# Install dependencies for both client and server
cd server && npm install
cd ../client && npm install
```

### Running Locally
```bash
# Terminal 1: Start WebSocket Signaling Server (Port 8080)
npm run dev:server

# Terminal 2: Start Vite Dev Client (Port 5173)
npm run dev:client
```

Open `http://localhost:5173/` in your browser.

---

## 📄 License
MIT License. Created as a flagship CS networking project.
