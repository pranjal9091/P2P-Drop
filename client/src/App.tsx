import { useState, useEffect, useRef } from 'react';
import { SignalingClient } from './services/signaling';
import { WebRTCManager } from './services/webrtcManager';
import type { Role, TransferProgress, IceDiagnosticStats, FileMetadata } from './types/webrtc';
import { SenderView } from './components/SenderView';
import { ReceiverView } from './components/ReceiverView';
import { SignalWaveform } from './components/SignalWaveform';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';
import { Radio, Activity } from 'lucide-react';

export function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [peerJoined, setPeerJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('idle');
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [receivedFile, setReceivedFile] = useState<{
    blob: Blob;
    metadata: FileMetadata;
    checksumVerified: boolean;
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState<IceDiagnosticStats | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const signalingRef = useRef<SignalingClient | null>(null);
  const rtcManagerRef = useRef<WebRTCManager | null>(null);
  const hasInitReceiverRef = useRef<string | null>(null);
  const hasAutoStartedRef = useRef<boolean>(false);
  
  // Ref to bypass React closure state staleness in WebSocket callbacks
  const roleRef = useRef<Role | null>(null);

  const updateRole = (newRole: Role | null) => {
    roleRef.current = newRole;
    setRole(newRole);
  };

  // Parse URL hash for auto-join room link
  useEffect(() => {
    const parseHash = () => {
      const hash = window.location.hash;
      const match = hash.match(/room=([A-Z0-9]{6})/i);
      if (match && match[1]) {
        const targetRoom = match[1].toUpperCase();
        if (hasInitReceiverRef.current !== targetRoom) {
          hasInitReceiverRef.current = targetRoom;
          updateRole('receiver');
          setRoomId(targetRoom);
          initReceiverFlow(targetRoom);
        }
      }
    };

    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, []);

  const initWebRTCManager = () => {
    if (rtcManagerRef.current) return rtcManagerRef.current;

    const manager = new WebRTCManager({
      onConnectionStateChange: (state) => {
        setConnectionState(state);
      },
      onProgressUpdate: (upd) => {
        setProgress(upd);
      },
      onFileReceived: (data) => {
        setReceivedFile(data);
      },
      onDiagnosticsUpdate: (stats) => {
        setDiagnostics(stats);
      },
      onError: (err) => {
        setErrorMsg(err);
      }
    });

    rtcManagerRef.current = manager;
    return manager;
  };

  const getSignalingClient = async () => {
    if (signalingRef.current) return signalingRef.current;

    const client = new SignalingClient();
    await client.connect();

    client.subscribe(async (msg) => {
      console.log('[App] Signaling message received:', msg.type, 'Current roleRef:', roleRef.current);

      const rtc = initWebRTCManager();

      switch (msg.type) {
        case 'ROOM_CREATED':
          setRoomId(msg.roomId);
          break;

        case 'ROOM_JOINED':
          setRoomId(msg.roomId);
          break;

        case 'PEER_JOINED':
          setPeerJoined(true);
          if (roleRef.current === 'sender' || !roleRef.current) {
            updateRole('sender');
            rtc.initializePeerConnection((cand) => client.sendIceCandidate(cand));
            rtc.createDataChannel('p2p-drop-channel');
            const offer = await rtc.createOffer();
            client.sendOffer(offer);
          }
          break;

        case 'OFFER':
          if (roleRef.current === 'receiver' || !roleRef.current) {
            updateRole('receiver');
            rtc.initializePeerConnection((cand) => client.sendIceCandidate(cand));
            const answer = await rtc.handleOffer(msg.offer);
            client.sendAnswer(answer);
          }
          break;

        case 'ANSWER':
          if (roleRef.current === 'sender') {
            await rtc.handleAnswer(msg.answer);
          }
          break;

        case 'ICE_CANDIDATE':
          await rtc.addIceCandidate(msg.candidate);
          break;

        case 'PEER_DISCONNECTED':
          setPeerJoined(false);
          setConnectionState('disconnected');
          setErrorMsg('Peer disconnected from signaling channel');
          break;

        case 'ERROR':
          setErrorMsg(msg.message);
          break;
      }
    });

    signalingRef.current = client;
    return client;
  };

  const handleCreateRoom = async () => {
    try {
      updateRole('sender');
      const sig = await getSignalingClient();
      sig.createRoom();
    } catch (err) {
      console.error('Failed to create room:', err);
      setErrorMsg('Failed to connect to signaling server at ws://localhost:8080');
    }
  };

  const handleStartSend = async () => {
    if (!selectedFile || !rtcManagerRef.current) return;
    try {
      await rtcManagerRef.current.sendFile(selectedFile);
    } catch (err: any) {
      console.error('Send error:', err);
      hasAutoStartedRef.current = false;
      setErrorMsg(err.message || 'File send failed');
    }
  };

  // Auto-start file stream on connection establishment for Sender
  useEffect(() => {
    if (
      connectionState === 'connected' &&
      role === 'sender' &&
      selectedFile &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      handleStartSend();
    }
  }, [connectionState, role, selectedFile]);

  const initReceiverFlow = async (roomCode: string) => {
    try {
      updateRole('receiver');
      const sig = await getSignalingClient();
      sig.joinRoom(roomCode);
    } catch (err) {
      console.error('Failed to join room:', err);
      setErrorMsg('Failed to connect to signaling server at ws://localhost:8080');
    }
  };

  const handleReset = () => {
    if (rtcManagerRef.current) {
      rtcManagerRef.current.close();
      rtcManagerRef.current = null;
    }
    if (signalingRef.current) {
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }
    hasInitReceiverRef.current = null;
    hasAutoStartedRef.current = false;
    updateRole(null);
    setRoomId(null);
    setSelectedFile(null);
    setPeerJoined(false);
    setConnectionState('idle');
    setProgress(null);
    setReceivedFile(null);
    setDiagnostics(null);
    setErrorMsg(null);
    window.location.hash = '';
  };

  const isTransferActive = progress?.status === 'transferring';

  return (
    <div className="min-h-screen bg-[#16151A] text-[#EDEAE3] flex flex-col font-sans selection:bg-[#E8A33D] selection:text-[#16151A]">
      {/* Top Signal Header Bar */}
      <header className="border-b border-[#2A2932] bg-[#1F1E24]/80 backdrop-blur-md sticky top-0 z-30 font-mono">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={handleReset}>
            <div className="p-1.5 bg-[#E8A33D]/10 rounded border border-[#E8A33D]/30 text-[#E8A33D]">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-xs tracking-wider text-[#EDEAE3] uppercase">
                P2P DROP // DIRECT SIGNAL STREAM
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
              connectionState === 'connected' ? 'bg-[#4FD1C5]/10 text-[#4FD1C5] border border-[#4FD1C5]/30' :
              connectionState === 'connecting' ? 'bg-[#E8A33D]/10 text-[#E8A33D] border border-[#E8A33D]/30' :
              'bg-[#16151A] text-[#8A8790] border border-[#2A2932]'
            }`}>
              ● SIGNAL: {connectionState.toUpperCase()}
            </span>

            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded border text-xs font-bold transition-all ${
                showDiagnostics
                  ? 'bg-[#E8A33D] text-[#16151A] border-[#E8A33D]'
                  : 'bg-[#16151A] hover:bg-[#2A2932] text-[#EDEAE3] border-[#2A2932]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>[ TELEMETRY ]</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Signal Architecture View */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8 flex flex-col justify-center">
        {/* Title Header */}
        {!role && !roomId && (
          <div className="text-center mb-6 space-y-2 font-mono">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#EDEAE3]">
              DIRECT DEVICE-TO-DEVICE BEAM
            </h1>
            <p className="text-xs sm:text-sm text-[#8A8790] max-w-lg mx-auto font-sans leading-relaxed">
              Transfer arbitrary files directly between two device memory heaps using WebRTC DataChannels. No intermediate storage, zero upload waiting.
            </p>
          </div>
        )}

        {/* Oscilloscope Connection Waveform Beam */}
        <SignalWaveform
          isActive={isTransferActive}
          throughputBps={progress?.speedBps || 0}
          connectionState={connectionState}
        />

        {/* Dual-Zone Peer Architecture Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {/* LOCAL TRANSMITTER NODE (Sender) */}
          <div className={role === 'receiver' ? 'opacity-40 pointer-events-none' : ''}>
            <SenderView
              file={selectedFile}
              onFileSelect={(f) => {
                setSelectedFile(f);
                updateRole('sender');
              }}
              roomId={roomId}
              onCreateRoom={handleCreateRoom}
              peerJoined={peerJoined}
              connectionState={connectionState}
              progress={role === 'sender' ? progress : null}
              onStartSend={handleStartSend}
              onReset={handleReset}
            />
          </div>

          {/* REMOTE RECEIVER NODE (Receiver) */}
          <div className={role === 'sender' ? 'opacity-40 pointer-events-none' : ''}>
            <ReceiverView
              roomId={roomId || ''}
              onJoinRoom={initReceiverFlow}
              connectionState={connectionState}
              progress={role === 'receiver' ? progress : null}
              receivedFile={receivedFile}
              error={errorMsg}
            />
          </div>
        </div>
      </main>

      {/* Footer Bar */}
      <footer className="border-t border-[#2A2932] bg-[#16151A] py-3 text-center text-[11px] text-[#8A8790] font-mono">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>P2P DROP // Direct Peer-to-Peer DataChannel Architecture</span>
          <span className="text-[#EDEAE3]">DTLS Point-to-Point Encrypted</span>
        </div>
      </footer>

      {/* Telemetry Drawer */}
      <DiagnosticsDrawer
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        stats={diagnostics}
        connectionState={connectionState}
        role={role}
      />
    </div>
  );
}

export default App;
