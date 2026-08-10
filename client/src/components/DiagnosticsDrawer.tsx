import React from 'react';
import type { IceDiagnosticStats } from '../types/webrtc';
import { X, Activity, Shield, Layers, Radio, Server } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  stats: IceDiagnosticStats | null;
  connectionState: string;
  role: string | null;
}

export const DiagnosticsDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  stats,
  connectionState,
  role
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[440px] bg-[#16151A]/98 backdrop-blur-md border-l border-[#2A2932] text-[#EDEAE3] p-6 z-50 overflow-y-auto shadow-2xl font-sans">
      {/* Header Readout */}
      <div className="flex items-center justify-between pb-4 border-b border-[#2A2932]">
        <div className="flex items-center space-x-2 font-mono">
          <Radio className="w-4 h-4 text-[#E8A33D]" />
          <span className="text-xs font-bold tracking-wider text-[#EDEAE3] uppercase">
            TELEMETRY READOUT // WEBRTC
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-[#8A8790] hover:text-[#EDEAE3] hover:bg-[#1F1E24] transition-colors border border-transparent hover:border-[#2A2932]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-6 space-y-6 text-xs">
        {/* Node Profile Matrix */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono font-bold text-[#8A8790] uppercase tracking-widest flex items-center space-x-1">
            <Layers className="w-3 h-3 text-[#E8A33D]" />
            <span>NODE PROFILE & PEER STATUS</span>
          </div>

          <div className="bg-[#1F1E24] rounded-lg border border-[#2A2932] divide-y divide-[#2A2932] font-mono">
            <div className="flex justify-between items-center p-3">
              <span className="text-[#8A8790]">LOCAL NODE ROLE</span>
              <span className={`font-bold px-2 py-0.5 rounded text-[11px] uppercase ${
                role === 'sender' ? 'text-[#E8A33D] bg-[#E8A33D]/10 border border-[#E8A33D]/30' :
                role === 'receiver' ? 'text-[#4FD1C5] bg-[#4FD1C5]/10 border border-[#4FD1C5]/30' :
                'text-[#8A8790]'
              }`}>
                {role || 'UNASSIGNED'}
              </span>
            </div>

            <div className="flex justify-between items-center p-3">
              <span className="text-[#8A8790]">ICE CONNECTION STATE</span>
              <span className={`font-bold px-2 py-0.5 rounded text-[11px] uppercase ${
                connectionState === 'connected' ? 'text-[#4FD1C5] bg-[#4FD1C5]/10 border border-[#4FD1C5]/30' :
                connectionState === 'connecting' ? 'text-[#E8A33D] bg-[#E8A33D]/10 border border-[#E8A33D]/30' :
                'text-[#8A8790]'
              }`}>
                {connectionState}
              </span>
            </div>

            <div className="flex justify-between items-center p-3">
              <span className="text-[#8A8790]">SIGNAL BROKER</span>
              <span className="text-[#EDEAE3]">WebSocket / JSON Relay</span>
            </div>
          </div>
        </div>

        {/* NAT Traversal Telemetry */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono font-bold text-[#8A8790] uppercase tracking-widest flex items-center space-x-1">
            <Server className="w-3 h-3 text-[#4FD1C5]" />
            <span>NAT TRAVERSAL & CANDIDATE PAIR</span>
          </div>

          <div className="bg-[#1F1E24] rounded-lg border border-[#2A2932] divide-y divide-[#2A2932] font-mono">
            <div className="flex justify-between items-center p-3">
              <span className="text-[#8A8790]">LOCAL CANDIDATE</span>
              <span className="text-[#E8A33D] font-bold">
                {stats?.localCandidateType ? stats.localCandidateType.toUpperCase() : 'SEARCHING...'}
              </span>
            </div>

            <div className="flex justify-between items-center p-3">
              <span className="text-[#8A8790]">REMOTE CANDIDATE</span>
              <span className="text-[#4FD1C5] font-bold">
                {stats?.remoteCandidateType ? stats.remoteCandidateType.toUpperCase() : 'SEARCHING...'}
              </span>
            </div>

            <div className="flex justify-between items-center p-3">
              <span className="text-[#8A8790]">TRANSPORT PROTOCOL</span>
              <span className="text-[#EDEAE3]">{stats?.localIpProtocol?.toUpperCase() || 'UDP (DTLS-SRTP)'}</span>
            </div>

            <div className="flex justify-between items-center p-3">
              <span className="text-[#8A8790]">PUBLIC STUN GATEWAY</span>
              <span className="text-[10px] text-[#EDEAE3]">stun.l.google.com:19302</span>
            </div>
          </div>
        </div>

        {/* Live Network Figures */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono font-bold text-[#8A8790] uppercase tracking-widest flex items-center space-x-1">
            <Activity className="w-3 h-3 text-[#E8A33D]" />
            <span>LIVE DATACHANNEL METRICS</span>
          </div>

          <div className="grid grid-cols-2 gap-3 font-mono">
            <div className="bg-[#1F1E24] p-3 rounded-lg border border-[#2A2932]">
              <span className="text-[#8A8790] text-[10px] block mb-1">ROUND TRIP TIME (RTT)</span>
              <span className="text-base font-bold text-[#E8A33D] tabular-nums">
                {stats?.currentRttMs !== undefined ? `${stats.currentRttMs} ms` : 'N/A'}
              </span>
            </div>

            <div className="bg-[#1F1E24] p-3 rounded-lg border border-[#2A2932]">
              <span className="text-[#8A8790] text-[10px] block mb-1">THROUGHPUT RATE</span>
              <span className="text-base font-bold text-[#4FD1C5] tabular-nums">
                {stats?.throughputBps ? `${(stats.throughputBps / (1024 * 1024)).toFixed(2)} MB/s` : '0 MB/s'}
              </span>
            </div>
          </div>
        </div>

        {/* DTLS Encryption Protocol */}
        <div className="bg-[#1F1E24] p-4 rounded-lg border border-[#2A2932] space-y-2">
          <div className="flex items-center space-x-2 text-[#4FD1C5] font-mono font-bold text-xs">
            <Shield className="w-4 h-4" />
            <span>ENCRYPTED DIRECT STREAM</span>
          </div>
          <div className="text-[11px] text-[#8A8790] leading-relaxed space-y-1">
            <p>• DataChannels are encrypted point-to-point via <strong className="text-[#EDEAE3]">DTLS 1.2+</strong>.</p>
            <p>• Zero server storage: Signaling server operates as SDP broker only and holds <strong className="text-[#EDEAE3]">0 bytes</strong> of payload.</p>
            <p>• Bit-perfect payload delivery guaranteed via <strong className="text-[#EDEAE3]">SHA-256 WebCrypto</strong>.</p>
          </div>
        </div>

        <div className="pt-2 text-center text-[10px] text-[#8A8790] uppercase tracking-widest font-mono">
          [ END READOUT ]
        </div>
      </div>
    </div>
  );
};
