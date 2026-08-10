export type Role = 'sender' | 'receiver';

export type ConnectionState = 
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  totalChunks: number;
  chunkSize: number;
  checksumSHA256: string;
}

export interface TransferProgress {
  fileId: string;
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  chunksTransferred: number;
  totalChunks: number;
  speedBps: number; // Bytes per second
  percentage: number;
  checksumVerified?: boolean;
  status: 'hashing' | 'transferring' | 'assembling' | 'completed' | 'error';
  errorMessage?: string;
}

export interface IceDiagnosticStats {
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
  localCandidateType?: string; // e.g. "host", "srflx", "relay"
  remoteCandidateType?: string; // e.g. "host", "srflx", "relay"
  localIpProtocol?: string;
  currentRttMs?: number; // Round trip time
  bytesSent: number;
  bytesReceived: number;
  throughputBps: number;
}

export type SignalingMessage =
  | { type: 'ROOM_CREATED'; roomId: string; peerId: string }
  | { type: 'ROOM_JOINED'; roomId: string; peerId: string }
  | { type: 'PEER_JOINED'; peerId: string }
  | { type: 'OFFER'; offer: RTCSessionDescriptionInit; senderId: string }
  | { type: 'ANSWER'; answer: RTCSessionDescriptionInit; senderId: string }
  | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit; senderId: string }
  | { type: 'PEER_DISCONNECTED'; peerId: string }
  | { type: 'ERROR'; message: string };
