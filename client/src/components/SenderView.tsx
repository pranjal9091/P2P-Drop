import React, { useState, useEffect, useRef } from 'react';
import type { TransferProgress } from '../types/webrtc';
import { Copy, Check, QrCode, ArrowRight, RefreshCw, Zap, Radio, FileText } from 'lucide-react';
import QRCode from 'qrcode';

interface Props {
  file: File | null;
  onFileSelect: (file: File) => void;
  roomId: string | null;
  onCreateRoom: () => void;
  peerJoined: boolean;
  connectionState: string;
  progress: TransferProgress | null;
  onStartSend: () => void;
  onReset: () => void;
}

export const SenderView: React.FC<Props> = ({
  file,
  onFileSelect,
  roomId,
  onCreateRoom,
  peerJoined,
  connectionState,
  progress,
  onStartSend,
  onReset
}) => {
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shareableUrl = roomId
    ? `${window.location.origin}${window.location.pathname}#room=${roomId}`
    : '';

  useEffect(() => {
    if (shareableUrl) {
      QRCode.toDataURL(shareableUrl, { margin: 2, width: 220, color: { dark: '#E8A33D', light: '#1F1E24' } })
        .then((url) => setQrUrl(url))
        .catch((err) => console.error('Failed to generate QR code:', err));
    }
  }, [shareableUrl]);

  const handleCopy = () => {
    if (!shareableUrl) return;
    navigator.clipboard.writeText(shareableUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const calculateEta = () => {
    if (!progress || !progress.speedBps || progress.speedBps === 0) return '--:--';
    const remainingBytes = progress.fileSize - progress.bytesTransferred;
    const seconds = Math.ceil(remainingBytes / progress.speedBps);
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6">
      {/* Node Header Label */}
      <div className="flex items-center justify-between font-mono text-xs text-[#8A8790] border-b border-[#2A2932] pb-2">
        <span className="flex items-center space-x-2 text-[#E8A33D] font-bold">
          <Radio className="w-4 h-4" />
          <span>LOCAL TRANSMITTER // NODE 01</span>
        </span>
        <span>STATUS: {connectionState.toUpperCase()}</span>
      </div>

      {/* Stage 1: Load Payload Dropzone */}
      {!file ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`crosshair-container border-2 border-dashed rounded-xl p-8 sm:p-12 text-center bg-[#1F1E24] cursor-pointer transition-all duration-200 ${
            isDragging
              ? 'border-[#E8A33D] bg-[#E8A33D]/5'
              : 'border-[#2A2932] hover:border-[#E8A33D]/60'
          }`}
        >
          {/* Crosshair corners visible on drag-over or hover */}
          <div className="crosshair-corner crosshair-top-left" />
          <div className="crosshair-corner crosshair-top-right" />
          <div className="crosshair-corner crosshair-bottom-left" />
          <div className="crosshair-corner crosshair-bottom-right" />

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
          />
          
          <div className="w-12 h-12 bg-[#E8A33D]/10 rounded-lg border border-[#E8A33D]/30 flex items-center justify-center mx-auto mb-3 text-[#E8A33D]">
            <FileText className="w-6 h-6" />
          </div>

          <h3 className="font-mono text-sm font-bold text-[#EDEAE3] mb-1">
            [ STAGE PAYLOAD FOR TRANSMISSION ]
          </h3>
          <p className="text-xs text-[#8A8790] max-w-sm mx-auto mb-4 font-sans leading-relaxed">
            Select or drop any binary file (MBs or GBs). Streams directly peer-to-peer from local browser memory.
          </p>

          <span className="inline-block px-4 py-2 bg-[#E8A33D] hover:bg-[#d49232] text-[#16151A] font-mono font-bold text-xs rounded transition-all shadow-md">
            BROWSE LOCAL PAYLOAD
          </span>
        </div>
      ) : (
        <div className="bg-[#1F1E24] rounded-xl p-5 border border-[#2A2932] space-y-5">
          {/* Staged File Specs */}
          <div className="bg-[#16151A] p-4 rounded-lg border border-[#2A2932] flex items-center justify-between">
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="p-2.5 bg-[#E8A33D]/10 rounded border border-[#E8A33D]/30 text-[#E8A33D] shrink-0 font-mono">
                TX
              </div>
              <div className="truncate">
                <h4 className="font-mono text-xs font-bold text-[#EDEAE3] truncate">{file.name}</h4>
                <p className="font-mono text-[11px] text-[#8A8790]">{formatBytes(file.size)}</p>
              </div>
            </div>
            {!progress && (
              <button
                onClick={onReset}
                className="text-xs font-mono text-[#8A8790] hover:text-[#EDEAE3] flex items-center space-x-1 px-2.5 py-1 bg-[#1F1E24] hover:bg-[#2A2932] rounded border border-[#2A2932] transition-colors shrink-0"
              >
                <RefreshCw className="w-3 h-3" />
                <span>CHANGE</span>
              </button>
            )}
          </div>

          {/* Stage 2: Initialize Frequency */}
          {!roomId ? (
            <button
              onClick={onCreateRoom}
              className="w-full py-3.5 bg-[#E8A33D] hover:bg-[#d49232] text-[#16151A] font-mono font-bold text-xs rounded-lg shadow-lg flex items-center justify-center space-x-2 transition-all uppercase tracking-wider"
            >
              <Zap className="w-4 h-4" />
              <span>GENERATE TRANSMISSION FREQUENCY</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="space-y-4">
              {/* Frequency Dial Banner */}
              <div className="space-y-1.5 font-mono">
                <span className="text-[10px] text-[#8A8790] uppercase tracking-widest block font-bold">
                  SIGNAL FREQUENCY DIAL
                </span>
                <div className="bg-[#16151A] border border-[#2A2932] rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-[#8A8790] block">ROOM FREQUENCY</span>
                    <span className="text-xl font-bold text-[#E8A33D] tracking-widest">{roomId}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleCopy}
                      className="px-3 py-2 bg-[#E8A33D] hover:bg-[#d49232] text-[#16151A] font-bold text-xs rounded flex items-center space-x-1.5 transition-colors"
                      title="Copy share link"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'COPIED' : 'COPY FREQUENCY LINK'}</span>
                    </button>
                    {qrUrl && (
                      <button
                        onClick={() => setShowQrModal(true)}
                        className="p-2 bg-[#1F1E24] hover:bg-[#2A2932] text-[#EDEAE3] rounded border border-[#2A2932] transition-colors"
                        title="Show QR Code"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Peer Receiver Connection Indicator */}
              <div className="bg-[#16151A] p-3 rounded-lg border border-[#2A2932] flex items-center justify-between text-xs font-mono">
                <span className="text-[#8A8790]">RECEIVER HANDSHAKE:</span>
                <span className={`font-bold flex items-center space-x-2 ${
                  connectionState === 'connected' ? 'text-[#4FD1C5]' :
                  peerJoined ? 'text-[#E8A33D]' : 'text-[#8A8790]'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    connectionState === 'connected' ? 'bg-[#4FD1C5] animate-pulse' :
                    peerJoined ? 'bg-[#E8A33D] animate-ping' : 'bg-[#2A2932]'
                  }`} />
                  <span>
                    {connectionState === 'connected' ? 'PEER DIRECT LINK LOCKED' :
                     peerJoined ? 'RECEIVER JOINED, HANDSHAKING...' :
                     'AWAITING REMOTE RECEIVER...'}
                  </span>
                </span>
              </div>

              {/* Execute Transmission Stream Button */}
              {connectionState === 'connected' && (!progress || progress.status === 'hashing') && (
                <button
                  onClick={onStartSend}
                  disabled={progress?.status === 'hashing'}
                  className="w-full py-3.5 bg-[#E8A33D] hover:bg-[#d49232] text-[#16151A] font-mono font-bold text-xs rounded-lg shadow-lg flex items-center justify-center space-x-2 transition-all uppercase tracking-wider disabled:opacity-50"
                >
                  <Zap className="w-4 h-4" />
                  <span>{progress?.status === 'hashing' ? 'COMPUTING SHA-256 HASH...' : 'START P2P TRANSMISSION STREAM'}</span>
                </button>
              )}
            </div>
          )}

          {/* Live Progress Display */}
          {progress && (
            <div className="bg-[#16151A] p-4 rounded-lg border border-[#2A2932] space-y-3 font-mono">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#E8A33D]">
                  {progress.status === 'hashing' ? 'HASHING_FILE_SHA256...' :
                   progress.status === 'transferring' ? 'TRANSMITTING_DATACHANNEL_BEAM...' :
                   progress.status === 'completed' ? 'TRANSMISSION_COMPLETE ✓' : 'PROCESSING...'}
                </span>
                <span className="text-[#EDEAE3] font-bold tabular-nums">{progress.percentage}%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-[#1F1E24] h-2 rounded overflow-hidden border border-[#2A2932]">
                <div
                  className="bg-[#E8A33D] h-full transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>

              {/* Monospace Figures Bar */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1 font-mono">
                <div className="bg-[#1F1E24] p-2 rounded border border-[#2A2932]">
                  <span className="text-[#8A8790] text-[9px] block">RATE</span>
                  <span className="text-[#E8A33D] font-bold tabular-nums">
                    {progress.speedBps ? `${(progress.speedBps / (1024 * 1024)).toFixed(2)} MB/s` : '0 MB/s'}
                  </span>
                </div>
                <div className="bg-[#1F1E24] p-2 rounded border border-[#2A2932]">
                  <span className="text-[#8A8790] text-[9px] block">ETA</span>
                  <span className="text-[#EDEAE3] font-bold tabular-nums">{calculateEta()}</span>
                </div>
                <div className="bg-[#1F1E24] p-2 rounded border border-[#2A2932]">
                  <span className="text-[#8A8790] text-[9px] block">CHUNKS</span>
                  <span className="text-[#EDEAE3] font-bold tabular-nums">
                    {progress.chunksTransferred}/{progress.totalChunks}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* QR Code Modal */}
      {showQrModal && qrUrl && (
        <div className="fixed inset-0 bg-[#16151A]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1F1E24] border border-[#2A2932] rounded-xl p-6 text-center max-w-sm w-full space-y-4 shadow-2xl font-mono">
            <h3 className="font-bold text-[#EDEAE3] text-xs uppercase tracking-wider">
              FREQUENCY QR SCANNER
            </h3>
            <div className="p-3 bg-[#16151A] rounded-lg inline-block border border-[#2A2932]">
              <img src={qrUrl} alt="Room QR Code" className="w-48 h-48 mx-auto" />
            </div>
            <p className="text-xs text-[#8A8790] font-sans">
              Scan with mobile camera to tune directly into this frequency link.
            </p>
            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2 bg-[#2A2932] hover:bg-[#34333e] text-[#EDEAE3] font-mono text-xs rounded transition-colors"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
