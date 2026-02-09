import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  volume: number; // 0 to 1
  isActive: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ volume, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const bars = 20;
    const barWidth = canvas.width / bars;
    
    // Smooth volume transition
    let currentVolume = 0;

    const render = () => {
      currentVolume += (volume - currentVolume) * 0.2;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
      gradient.addColorStop(0, '#3b82f6'); // Blue
      gradient.addColorStop(0.5, '#ef4444'); // Red
      gradient.addColorStop(1, '#ef4444');

      ctx.fillStyle = gradient;

      for (let i = 0; i < bars; i++) {
        // Create a wave effect
        const noise = isActive ? Math.random() * 0.2 : 0;
        const barHeight = isActive 
           ? Math.max(2, (currentVolume * canvas.height * 1.5) * (Math.sin(i * 0.5 + Date.now() / 100) + 1.5) + (noise * 50))
           : 2;

        const x = i * barWidth;
        const y = (canvas.height - barHeight) / 2;
        
        // Rounded bars
        ctx.beginPath();
        ctx.roundRect(x + 2, y, barWidth - 4, barHeight, 4);
        ctx.fill();
      }

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [volume, isActive]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={60} 
      className="w-full h-full"
    />
  );
};

export default AudioVisualizer;
