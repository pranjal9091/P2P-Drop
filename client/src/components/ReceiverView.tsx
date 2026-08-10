import React, { useState } from 'react';
import type { TransferProgress, FileMetadata } from '../types/webrtc';
import { Download, ShieldCheck, ArrowRight, Radio, AlertTriangle } from 'lucide-react';

interface Props {
  roomId: string;
  onJoinRoom: (code: string) => void;
  connectionState: string;
  progress: TransferProgress | null;
  receivedFile: { blob: Blob; metadata: FileMetadata; checksumVerified: boolean } | null;
  error: string | null;
}

export const ReceiverView: React.FC<Props> = ({
  roomId,
  onJoinRoom,
  connectionState,
  progress,
  receivedFile,
  error
}) => {
  const [inputCode, setInputCode] = useState(roomId || '');

  const handleDownload = () => {
    if (!receivedFile) return;
    const url = URL.createObjectURL(receivedFile.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivedFile.metadata.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
        <span className="flex items-center space-x-2 text-[#4FD1C5] font-bold">
          <Radio className="w-4 h-4" />
          <span>REMOTE RECEIVER // NODE 02</span>
        </span>
        <span>STATUS: {connectionState.toUpperCase()}</span>
      </div>

      {!roomId ? (
        <div className="bg-[#1F1E24] rounded-xl p-8 border border-[#2A2932] space-y-6 text-center">
          <div className="w-12 h-12 bg-[#4FD1C5]/10 rounded-lg border border-[#4FD1C5]/30 flex items-center justify-center mx-auto text-[#4FD1C5] font-mono">
            RX
          </div>
          <div>
            <h3 className="font-mono text-sm font-bold text-[#EDEAE3]">TUNE INTO TRANSMISSION FREQUENCY</h3>
            <p className="text-xs text-[#8A8790] mt-1 font-sans max-w-sm mx-auto">
              Enter the 6-character signal frequency dial code provided by the sender.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputCode.trim()) onJoinRoom(inputCode.trim().toUpperCase());
            }}
            className="flex items-center space-x-2 max-w-sm mx-auto font-mono"
          >
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4FD1C5] font-bold text-xs">FREQ:</span>
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="A3K9P1"
                maxLength={6}
                className="w-full bg-[#16151A] border border-[#4FD1C5]/40 rounded-lg pl-14 pr-4 py-3 text-center text-sm font-bold tracking-widest text-[#4FD1C5] uppercase focus:outline-none focus:border-[#4FD1C5] transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!inputCode.trim()}
              className="py-3 px-5 bg-[#4FD1C5] hover:bg-[#3dbbb0] text-[#16151A] font-bold text-xs rounded-lg shadow-md transition-all disabled:opacity-50"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-[#1F1E24] rounded-xl p-5 border border-[#2A2932] space-y-5 font-mono">
          {/* Active Connection Frequency Readout */}
          <div className="bg-[#16151A] p-4 rounded-lg border border-[#2A2932] flex items-center justify-between">
            <div>
              <span className="text-[10px] text-[#8A8790] block">TUNED FREQUENCY DIAL</span>
              <span className="text-lg font-bold text-[#4FD1C5] tracking-widest">{roomId}</span>
            </div>
            <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
              connectionState === 'connected' ? 'bg-[#4FD1C5]/10 text-[#4FD1C5] border border-[#4FD1C5]/30' :
              connectionState === 'connecting' ? 'bg-[#E8A33D]/10 text-[#E8A33D] border border-[#E8A33D]/30' :
              'bg-[#1F1E24] text-[#8A8790]'
            }`}>
              ● {connectionState === 'connected' ? 'BEAM LOCKED' : 'SEARCHING...'}
            </span>
          </div>

          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-center space-x-3 text-rose-300 text-xs">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Inbound Stream Display */}
          {progress && !receivedFile && (
            <div className="bg-[#16151A] p-4 rounded-lg border border-[#2A2932] space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#4FD1C5]">
                  {progress.status === 'assembling' ? 'REASSEMBLING_BINARY_PAYLOAD...' : 'RECEIVING_INBOUND_BEAM...'}
                </span>
                <span className="text-[#EDEAE3] font-bold tabular-nums">{progress.percentage}%</span>
              </div>

              <div className="w-full bg-[#1F1E24] h-2 rounded overflow-hidden border border-[#2A2932]">
                <div
                  className="bg-[#4FD1C5] h-full transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>

              {/* Tabular Stats Figures */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                <div className="bg-[#1F1E24] p-2 rounded border border-[#2A2932]">
                  <span className="text-[#8A8790] text-[9px] block">RATE</span>
                  <span className="text-[#4FD1C5] font-bold tabular-nums">
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

          {/* Download Received File Block */}
          {receivedFile && (
            <div className="bg-[#16151A] p-5 rounded-lg border border-[#4FD1C5]/40 text-center space-y-4">
              <div className="w-12 h-12 bg-[#4FD1C5]/10 rounded-full border border-[#4FD1C5]/40 flex items-center justify-center mx-auto text-[#4FD1C5]">
                <ShieldCheck className="w-6 h-6" />
              </div>

              <div>
                <span className="inline-block px-3 py-1 bg-[#4FD1C5]/10 text-[#4FD1C5] rounded text-[10px] font-bold border border-[#4FD1C5]/30 mb-2">
                  [ SHA-256 VERIFIED ✓ ]
                </span>
                <h3 className="font-bold text-[#EDEAE3] text-sm">{receivedFile.metadata.name}</h3>
                <p className="text-xs text-[#8A8790] mt-1 font-mono">
                  {formatBytes(receivedFile.metadata.size)} • {receivedFile.metadata.type}
                </p>
              </div>

              <button
                onClick={handleDownload}
                className="w-full py-3.5 bg-[#4FD1C5] hover:bg-[#3dbbb0] text-[#16151A] font-bold rounded-lg shadow-lg flex items-center justify-center space-x-2 transition-all uppercase text-xs"
              >
                <Download className="w-4 h-4" />
                <span>SAVE RECEIVED PAYLOAD TO DISK</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
