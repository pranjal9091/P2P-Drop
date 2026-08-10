import React, { useEffect, useRef } from 'react';

interface Props {
  isActive: boolean;
  throughputBps: number;
  connectionState: string;
}

export const SignalWaveform: React.FC<Props> = ({
  isActive,
  throughputBps,
  connectionState
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const render = () => {
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Draw subtle grid line behind wave
      ctx.beginPath();
      ctx.strokeStyle = '#2A2932';
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      if (connectionState !== 'connected' && connectionState !== 'connecting') {
        // Flat line when not connected
        ctx.beginPath();
        ctx.strokeStyle = '#8A8790';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      // Determine Waveform Amplitude & Speed based on throughput
      let targetAmplitude = 4; // Idle carrier wave
      if (isActive && throughputBps > 0) {
        // Scale amplitude dynamically between 8px and 38px
        const mbps = throughputBps / (1024 * 1024);
        targetAmplitude = Math.min(38, Math.max(8, mbps * 3 + 10));
      } else if (connectionState === 'connecting') {
        targetAmplitude = 6;
      }

      const speed = prefersReducedMotion ? 0.01 : (isActive ? 0.08 : 0.03);
      phase += speed;

      // Draw Oscilloscope Line with Amber -> Teal Gradient
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#E8A33D'); // Signal Amber (Local Sender)
      gradient.addColorStop(1, '#4FD1C5'); // Signal Teal (Remote Receiver)

      ctx.beginPath();
      ctx.strokeStyle = gradient;
      ctx.lineWidth = isActive ? 2.5 : 1.5;

      for (let x = 0; x <= width; x += 2) {
        const normalizedX = x / width;
        // Dampen amplitude at endpoints (0 and width) so wave pins smoothly to sides
        const envelope = Math.sin(normalizedX * Math.PI);
        
        // Multi-frequency harmonic wave formulation
        const wave1 = Math.sin(x * 0.03 + phase) * targetAmplitude;
        const wave2 = isActive ? Math.sin(x * 0.07 - phase * 1.5) * (targetAmplitude * 0.4) : 0;
        
        const y = centerY + (wave1 + wave2) * envelope;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();

      // Render glowing lead node pulses at connection endpoints
      ctx.beginPath();
      ctx.fillStyle = '#E8A33D';
      ctx.arc(4, centerY, isActive ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = '#4FD1C5';
      ctx.arc(width - 4, centerY, isActive ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isActive, throughputBps, connectionState]);

  return (
    <div className="w-full py-3 my-2 relative">
      <div className="flex justify-between items-center text-[10px] font-mono text-[#8A8790] uppercase tracking-wider mb-1 px-1">
        <span className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E8A33D]" />
          <span>TX // SIGNAL ORIGIN</span>
        </span>
        <span className="text-center font-bold text-[#EDEAE3]">
          {connectionState === 'connected'
            ? isActive
              ? 'ACTIVE DATACHANNEL BEAM'
              : 'DIRECT SIGNAL LOCKED'
            : 'SIGNAL SEARCHING...'}
        </span>
        <span className="flex items-center space-x-1">
          <span>RX // SIGNAL LANDING</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#4FD1C5]" />
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full h-16 bg-[#1F1E24] rounded-lg border border-[#2A2932] block"
      />
    </div>
  );
};
