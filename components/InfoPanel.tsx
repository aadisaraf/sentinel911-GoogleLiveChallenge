
import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Radio, User, Mic } from 'lucide-react';
import clsx from 'clsx';

interface InfoPanelProps {
  logs: LogEntry[];
  isConnecting: boolean;
}

const InfoPanel: React.FC<InfoPanelProps> = ({ 
  logs, 
  isConnecting 
}) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-gray-900/60 backdrop-blur-md rounded-xl border border-gray-800 overflow-hidden shadow-2xl">
      <div className="p-3 border-b border-gray-800 bg-black/40 flex justify-between items-center">
         <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
           <Radio size={12} /> Live Transcript
         </span>
         <div className="flex gap-1">
           <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
         </div>
      </div>

      {/* Transcript Log */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide bg-black/20">
        {logs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-700 space-y-4 opacity-40">
             {isConnecting ? (
               <div className="flex flex-col items-center gap-3">
                 <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                 <p className="text-[10px] font-mono tracking-widest uppercase">Initializing AI Protocol</p>
               </div>
             ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="p-4 rounded-full bg-gray-800/50">
                    <Mic size={32} />
                  </div>
                  <p className="text-[10px] font-mono tracking-widest uppercase text-center">Ready for Secure Monitoring</p>
                </div>
             )}
          </div>
        )}
        
        {logs.map((log) => (
          <div 
            key={log.id} 
            className={clsx(
              "flex flex-col max-w-[95%] rounded-lg p-2.5 text-xs shadow-sm transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 border",
              log.source === 'user' 
                ? "ml-auto bg-blue-950/30 border-blue-500/20 text-blue-100" 
                : log.source === 'system'
                  ? "mx-auto bg-gray-800/20 border-gray-700/50 italic text-gray-500 text-center scale-95"
                  : "mr-auto bg-gray-800/60 border-gray-700 text-gray-200"
            )}
          >
             <div className="flex items-center gap-2 mb-1 opacity-50">
                {log.source === 'user' ? <User size={8} /> : <Radio size={8} />}
                <span className="text-[8px] font-bold uppercase tracking-widest">
                  {log.source === 'user' ? 'Caller' : log.source === 'system' ? 'System' : 'Sentinel-3'}
                </span>
             </div>
             <p className="leading-relaxed font-medium whitespace-pre-wrap">{log.text}</p>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default InfoPanel;
