
import React, { useState, useCallback, useRef, useEffect } from 'react';
import LiveMap, { SecondaryLocation, DispatchRoute } from './components/LiveMap';
import InfoPanel from './components/InfoPanel';
import AudioVisualizer from './components/AudioVisualizer';
import { LocationData, CallState, LogEntry, IncidentDetails, ProtocolStep } from './types';
import { LiveClient } from './services/liveClient';
import { Type } from '@google/genai';
import { Siren, Activity, ShieldCheck, BrainCircuit, Globe, Zap, Mic, FileText, AlertOctagon, CheckCircle2, Play, ClipboardList, Server, Radio, Truck, Navigation, Camera, MessageCircle, HeartPulse, ShieldAlert, Video, VideoOff } from 'lucide-react';
import clsx from 'clsx';
import RBush from 'rbush';
import policeStationsData from './utils/policeStations.json';

// Spatial Index for Police Stations
interface PoliceStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
}

// RBush adapter: [minX, minY, maxX, maxY, data]
interface StationItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  station: PoliceStation;
}

const stationIndex = new RBush<StationItem>();
const stationItems: StationItem[] = (policeStationsData as any[]).map(p => ({
  minX: p.lng,
  minY: p.lat,
  maxX: p.lng,
  maxY: p.lat,
  station: p
}));
stationIndex.load(stationItems);

import { decryptData } from './utils/cryptoUtils';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

const App: React.FC = () => {
  const [callState, setCallState] = useState<CallState>({
    isActive: false,
    isConnecting: false,
    callerTone: 'Analyzing...',
    emergencyType: '',
    summary: '',
    suggestedActions: [],
    suggestedQuestions: [],
    incidentDetails: {
      situation: 'Unknown',
      personsInvolved: 'Unknown',
      weapons: 'Unknown',
      activeThreats: 'Unknown',
      infrastructureStatus: 'Unknown',
      suggestedActions: [],
      suggestedQuestions: [],
      tone: 'Analyzing...',
      emergencyType: '',
      activeProtocol: null
    }
  });

  const [location, setLocation] = useState<LocationData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [volume, setVolume] = useState(0);
  const [autonomousActions, setAutonomousActions] = useState<{ id: string, action: string, status: 'pending' | 'success' | 'failed', timestamp: Date }[]>([]);
  const [reconImage, setReconImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [executedActions, setExecutedActions] = useState<Set<string>>(new Set());
  const [perimeterRadius, setPerimeterRadius] = useState(0);
  const [secondaryLocations, setSecondaryLocations] = useState<SecondaryLocation[]>([]);
  const [dispatchRoutes, setDispatchRoutes] = useState<DispatchRoute[]>([]);
  const [isWebcamActive, setIsWebcamActive] = useState(false);

  const clientRef = useRef<LiveClient | null>(null);
  const transcriptRef = useRef<string>("");
  const lastSourceRef = useRef<LogEntry['source'] | null>(null);
  const locationRef = useRef<LocationData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autonomousActionsRef = useRef<{ id: string, action: string, status: 'pending' | 'success' | 'failed', timestamp: Date }[]>([]);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (clientRef.current) {
        clientRef.current.sendVisionUpdate(base64);
        addLog(`[LIVE CAMERA STREAM INITIATED] - Sending visual telemetry`, 'system');
      }
    };
    reader.readAsDataURL(file);
  };

  // Keep autonomousActionsRef in sync
  useEffect(() => {
    autonomousActionsRef.current = autonomousActions;
  }, [autonomousActions]);

  // ── LIVE WEBCAM STREAMING ──────────────────────────────────────────────
  // Captures frames at ~1fps and streams to Gemini Live API for real-time visual analysis
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } });
      webcamStreamRef.current = stream;
      if (webcamRef.current) {
        webcamRef.current.srcObject = stream;
        await webcamRef.current.play();
      }
      setIsWebcamActive(true);
      addLog('[LIVE CAMERA UPLINK] - Streaming visual telemetry at 1fps', 'system');

      // Capture and send frames at ~1fps
      webcamIntervalRef.current = setInterval(() => {
        if (!webcamRef.current || !webcamCanvasRef.current || !clientRef.current) return;
        const video = webcamRef.current;
        const canvas = webcamCanvasRef.current;
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, 640, 480);
        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        clientRef.current.sendVisionUpdate(base64);
      }, 1000);
    } catch (e) {
      console.error('Webcam access failed:', e);
      addLog('[CAMERA ERROR] - Unable to access camera', 'system');
    }
  };

  const stopWebcam = () => {
    if (webcamIntervalRef.current) {
      clearInterval(webcamIntervalRef.current);
      webcamIntervalRef.current = null;
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(t => t.stop());
      webcamStreamRef.current = null;
    }
    if (webcamRef.current) {
      webcamRef.current.srcObject = null;
    }
    setIsWebcamActive(false);
    addLog('[CAMERA FEED TERMINATED]', 'system');
  };

  // Keep locationRef in sync with location state
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Consolidated Logging for Streaming Text
  const addLog = useCallback((text: string, source: LogEntry['source']) => {
    setLogs(prev => {
      const last = prev[prev.length - 1];
      // Only concatenate if same source AND it's streaming text (short additions < 100 chars)
      // This creates new bubbles when source alternates between user/assistant
      if (last && last.source === source && source !== 'system' && text.length < 100) {
        // Check if we just had a source change - if so, start new bubble
        if (lastSourceRef.current !== source) {
          return [...prev, {
            id: Math.random().toString(36).substring(7),
            timestamp: new Date(),
            source,
            text,
          }];
        }
        return [
          ...prev.slice(0, -1),
          { ...last, text: last.text + text }
        ];
      }
      return [...prev, {
        id: Math.random().toString(36).substring(7),
        timestamp: new Date(),
        source,
        text,
      }];
    });

    if (source !== 'system') {
      if (lastSourceRef.current === source) {
        transcriptRef.current += text;
      } else {
        transcriptRef.current += `\n${source === 'user' ? 'CALLER' : 'AI'}: ${text}`;
      }
      lastSourceRef.current = source;
    }
  }, []);

  const handleExecuteAction = (action: string) => {
    if (executedActions.has(action)) return;
    setExecutedActions(prev => new Set(prev).add(action));
    addLog(`SYSTEM COMMAND: ${action} - EXECUTING...`, 'system');

    // Simulate system response latency
    setTimeout(() => {
      addLog(`COMMAND CONFIRMED: ${action} - Success`, 'system');
    }, 1200);
  };

  const respondersImageGenerated = useRef(false);

  const generateVisualRecon = async (address: string, withResponders = false) => {
    setIsGeneratingImage(true);
    setReconImage(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/recon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, withResponders })
      });
      const encryptedData = await res.json();
      const data = decryptData(encryptedData);

      if (data.image) {
        setReconImage(`data:image/jpeg;base64,${data.image}`);
        addLog(withResponders
          ? `Visual updated: First responders on scene at ${address}`
          : `Drone uplink established for sector: ${address}`, 'system');
      } else {
        throw new Error(data.error || "No image generated");
      }
    } catch (e) {
      console.error("Failed to generate recon image", e);
      addLog(`Visual feed connection failed for ${address}`, 'system');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const safeFetch = async (url: string) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const targetUrl = new URL(url);
      targetUrl.searchParams.set('format', 'json');
      targetUrl.searchParams.set('email', 'demo@sentinel3.org');
      targetUrl.searchParams.set('addressdetails', '1');
      const response = await fetch(targetUrl.toString(), { signal: controller.signal });
      clearTimeout(id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      return null;
    }
  };

  const geocodeAddress = async (address: string) => {
    const data = await safeFetch(`${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(address)}&limit=1`);
    if (Array.isArray(data) && data[0]) {
      setLocation({
        address,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        confidence: 'Locked'
      });
      addLog(`Visual reconnaissance established: ${address}`, 'system');
      generateVisualRecon(address);
    } else {
      addLog(`Visual recon unavailable for: ${address}`, 'system');
    }
  };

  // Gemini 3 Flash Loop: Structured Debrief, Suggestions & Stats
  useEffect(() => {
    if (!callState.isActive) return;
    const updateDebrief = async () => {
      if (transcriptRef.current.length < 15) return;
      try {
        const res = await fetch(`${BACKEND_URL}/api/analyze/incident`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: transcriptRef.current })
        });
        const encryptedData = await res.json();
        const decryptedText = decryptData(encryptedData);
        const json = JSON.parse(decryptedText) as IncidentDetails;

        // Tone stability: only update if shift is 2+ levels to prevent flickering
        const toneScale = ['Calm', 'Controlled', 'Urgent', 'Distressed', 'Panic'];

        setCallState(prev => {
          const prevIdx = toneScale.indexOf(prev.callerTone);
          const newIdx = toneScale.indexOf(json.tone || '');
          const updateTone = prevIdx === -1 || newIdx === -1 || Math.abs(newIdx - prevIdx) >= 2;
          return {
            ...prev,
            incidentDetails: json,
            callerTone: updateTone ? (json.tone || prev.callerTone) : prev.callerTone,
            emergencyType: json.emergencyType || prev.emergencyType,
            summary: json.situation || prev.summary,
            suggestedActions: json.suggestedActions || [],
            suggestedQuestions: json.suggestedQuestions || []
          };
        });
      } catch (e) {
        console.warn('Debrief update failed', e);
      }
    };
    const interval = setInterval(updateDebrief, 1500);
    return () => clearInterval(interval);
  }, [callState.isActive]);

  // 🚀 AUTONOMOUS DISPATCH MODE: Gemini 3 Flash proactively takes actions
  // This is the "Marathon Agent" feature - AI acts WITHOUT user input
  useEffect(() => {
    if (!callState.isActive) return;

    let isProcessing = false;

    const runAutonomousDispatch = async () => {
      // Don't run if already processing or not enough context
      if (isProcessing || transcriptRef.current.length < 50) return;
      if (!callState.summary || callState.summary === 'Unknown') return;

      isProcessing = true;

      try {
        const reqPayload = {
          summary: callState.summary,
          emergencyType: callState.emergencyType || 'Unknown',
          activeThreats: callState.incidentDetails.activeThreats,
          infrastructureStatus: callState.incidentDetails.infrastructureStatus,
          personsInvolved: callState.incidentDetails.personsInvolved,
          actionsTaken: autonomousActionsRef.current.map(a => a.action)
        };

        const res = await fetch(`${BACKEND_URL}/api/analyze/autonomous`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload)
        });
        const encryptedData = await res.json();
        const decryptedText = decryptData(encryptedData);
        
        const decision = JSON.parse(decryptedText) as {
          shouldAct: boolean;
          action: string;
          reason: string;
          details: string;
        };

        if (decision.shouldAct && decision.action && decision.action !== 'none') {
          // Format the autonomous action
          const actionLabels: Record<string, string> = {
            'dispatch_backup': `🚔 AUTO: Dispatching backup - ${decision.details || decision.reason}`,
            'expand_perimeter': `🔒 AUTO: Expanding perimeter - ${decision.details || decision.reason}`,
            'request_air_support': `🚁 AUTO: Requesting air support - ${decision.details || decision.reason}`,
            'notify_hospitals': `🏥 AUTO: Alerting hospitals - ${decision.details || decision.reason}`,
          };

          const actionLabel = actionLabels[decision.action] || `🤖 AUTO: ${decision.action}`;

          // Add to log with pending status
          const actionId = Math.random().toString(36).substring(7);
          setAutonomousActions(prev => [...prev, {
            id: actionId,
            action: actionLabel,
            status: 'pending',
            timestamp: new Date()
          }]);

          // Simulate verification then mark success
          setTimeout(() => {
            setAutonomousActions(prev =>
              prev.map(a => a.id === actionId ? { ...a, status: 'success' } : a)
            );
          }, 2000 + Math.random() * 1500);
        }

      } catch (e) {
        console.warn('Autonomous dispatch check failed', e);
      } finally {
        isProcessing = false;
      }
    };

    // Run autonomous check every 6 seconds (not too aggressive to avoid interference)
    const interval = setInterval(runAutonomousDispatch, 6000);

    // Also run once after initial context is gathered
    const initialDelay = setTimeout(runAutonomousDispatch, 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialDelay);
    };
  }, [callState.isActive, callState.summary, callState.emergencyType, callState.incidentDetails]);

  // Helper to add autonomous action log
  const addAutonomousAction = useCallback((action: string, status: 'pending' | 'success' | 'failed' = 'pending') => {
    const id = Math.random().toString(36).substring(7);
    setAutonomousActions(prev => [...prev, { id, action, status, timestamp: new Date() }]);
    return id;
  }, []);

  const updateAutonomousAction = useCallback((id: string, status: 'success' | 'failed') => {
    setAutonomousActions(prev => prev.map(a => a.id === id ? { ...a, status } : a));
  }, []);

  const startCall = async () => {
    setCallState(prev => ({ ...prev, isConnecting: true }));
    transcriptRef.current = "";
    setAutonomousActions([]);
    setReconImage(null);
    respondersImageGenerated.current = false;
    setExecutedActions(new Set());
    setPerimeterRadius(0);
    setSecondaryLocations([]);
    setDispatchRoutes([]);
    setLocation(null);

    addLog('Triangulating nearest response station...', 'system');

    // Triangulate before starting the neural grid connection
    await new Promise<void>((resolve) => {
      if (!("geolocation" in navigator)) {
        setLocation({ address: "Central Command [Default]", lat: 40.7128, lng: -74.0060, confidence: 'Default' });
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        
        // OPTIMIZED ALGORITHM: Use R-Tree bounding box search (Spatial Indexing)
        const SEARCH_RADIUS_DEG = 0.5; // Approx 30-35 miles
        const candidates = stationIndex.search({
          minX: longitude - SEARCH_RADIUS_DEG,
          minY: latitude - SEARCH_RADIUS_DEG,
          maxX: longitude + SEARCH_RADIUS_DEG,
          maxY: latitude + SEARCH_RADIUS_DEG
        });

        let nearest = null;
        let minDist = Infinity;

        // Linear scan only on the small subset of candidates
        for (const item of candidates) {
            const d = Math.pow(item.station.lat - latitude, 2) + Math.pow(item.station.lng - longitude, 2);
            if (d < minDist) {
                minDist = d;
                nearest = item.station;
            }
        }

        if (nearest) {
            setLocation({
              address: `[NEAREST HQ] ${nearest.name}`,
              lat: nearest.lat,
              lng: nearest.lng,
              confidence: 'Station Lock (Local DB)'
            });
            addLog(`Fast-Search: Nearest Dept Found (${nearest.name})`, 'system');
        } else {
            setLocation({
              address: `Sector Grid: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
              lat: latitude,
              lng: longitude,
              confidence: 'GPS Signal'
            });
            addLog(`Triangulated approximate GPS coordinates`, 'system');
        }
        resolve();
      }, () => {
        setLocation({ address: "Central Command [Default]", lat: 40.7128, lng: -74.0060, confidence: 'Default' });
        resolve();
      });
    });

    addLog('Connecting to City Neural Grid...', 'system');

    clientRef.current = new LiveClient({
      onOpen: () => {
        setCallState(prev => ({ ...prev, isActive: true, isConnecting: false }));
        addLog('Sentinel-3 Operational. Operations Command Active.', 'system');
      },
      onClose: () => {
        setCallState(prev => ({ ...prev, isActive: false, isConnecting: false }));
        addLog('Signal Link Terminated.', 'system');
      },
      onVolumeChange: setVolume,
      onLocationFound: geocodeAddress,
      onTranscript: (text, source) => addLog(text, source),
      onTurnComplete: () => { },
      onToolCall: (toolName, args) => {
        if (toolName === 'log_translation') {
            addLog(`💬 [TRANSLATED from ${args.originalLanguage.toUpperCase()}]: ${args.englishTranslation}`, 'assistant');
            return;
        }

        // Format tool call for display
        const toolLabels: Record<string, string> = {
          'set_location': `📍 Location Lock: ${args.address}`,
          'dispatch_unit': `🚨 Dispatch ${args.unitType?.toUpperCase()} → ${args.location}`,
          'lockdown_sector': `🔒 Lockdown ${args.sectorId} (${args.level})`,
          'deploy_drones': `🛸 Deploy ${args.count} drone(s) → ${args.location}`,
          'generate_report': `📋 Report: ${args.incidentType}`,
          'control_traffic_lights': `🚦 Traffic Ovrd: ${args.routeId} (${args.status})`,
          'access_medical_records': `🏥 Med Db Access: Priority Intel for ${args.personName}`,
          'issue_evacuation_warning': `⚠️ SYSTEM-WIDE EVAC: ${args.radiusMeters}m radius (${args.reason})`,
        };
        const actionLabel = toolLabels[toolName] || `${toolName}: ${JSON.stringify(args)}`;

        // Add to autonomous actions log with pending status
        const actionId = addAutonomousAction(actionLabel, 'pending');

        // Handle specific tool effects
        if (toolName === 'lockdown_sector') {
          setPerimeterRadius(200);
        }

        // Create dispatch route when a unit is dispatched
        if (toolName === 'dispatch_unit') {
          const currentLoc = locationRef.current;
          if (!currentLoc) return;

          const unitType = args.unitType?.toLowerCase() || 'police';
          const dest: [number, number] = [currentLoc.lat, currentLoc.lng];

          // Station offsets relative to incident (appear ~1km away on map)
          const stations: Record<string, { name: string; offset: [number, number]; color: string; emoji: string }> = {
            fire: {
              name: 'Fire Station 86',
              offset: [0.008, -0.012],
              color: '#ef4444',
              emoji: '🚒'
            },
            police: {
              name: 'Police HQ',
              offset: [-0.006, 0.010],
              color: '#3b82f6',
              emoji: '🚔'
            },
            ambulance: {
              name: 'Regional Hospital',
              offset: [0.010, 0.008],
              color: '#22c55e',
              emoji: '🚑'
            },
            hazmat: {
              name: 'HAZMAT Depot',
              offset: [-0.009, -0.011],
              color: '#f59e0b',
              emoji: '☢️'
            }
          };

          const station = stations[unitType] || stations.police;
          const stationCoords: [number, number] = [
            dest[0] + station.offset[0],
            dest[1] + station.offset[1]
          ];

          // Fetch real road route from OSRM (free routing API)
          const fetchRoadRoute = async (): Promise<[number, number][]> => {
            try {
              const url = `https://router.project-osrm.org/route/v1/driving/${stationCoords[1]},${stationCoords[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`;
              const resp = await fetch(url);
              const data = await resp.json();
              if (data.routes && data.routes[0]) {
                // OSRM returns [lng, lat] - convert to [lat, lng]
                return data.routes[0].geometry.coordinates.map(
                  (c: [number, number]) => [c[1], c[0]] as [number, number]
                );
              }
            } catch (e) {
              console.warn('OSRM routing failed, using fallback', e);
            }
            // Fallback: generate a curved path with many points
            const points: [number, number][] = [];
            const segments = 20;
            for (let i = 0; i <= segments; i++) {
              const t = i / segments;
              const lat = stationCoords[0] + (dest[0] - stationCoords[0]) * t + Math.sin(t * Math.PI) * 0.002 * (Math.random() - 0.3);
              const lng = stationCoords[1] + (dest[1] - stationCoords[1]) * t + Math.sin(t * Math.PI) * 0.002 * (Math.random() - 0.3);
              points.push([lat, lng]);
            }
            return points;
          };

          // Async route creation
          fetchRoadRoute().then(waypoints => {
            const newRoute: DispatchRoute = {
              id: `${unitType}-${Date.now()}`,
              unitType,
              stationName: station.name,
              stationCoords,
              destinationCoords: dest,
              waypoints,
              color: station.color,
              emoji: station.emoji,
              dispatchedAt: Date.now()
            };
            setDispatchRoutes(prev => [...prev, newRoute]);
          });
        }

        // Simulate verification delay then mark as success
        setTimeout(() => {
          updateAutonomousAction(actionId, 'success');
        }, 1500 + Math.random() * 1000);
      },
      onError: (err) => {
        if (err.message && (err.message.includes("Operation is not implemented") || err.message.includes("Internal error"))) {
          console.warn("Ignoring transient API error");
          return;
        }
        addLog(`Protocol Interruption: ${err.message}`, 'system');
        setCallState(prev => ({ ...prev, isConnecting: false, isActive: false }));
      }
    });

    await clientRef.current.connect();
  };

  return (
    <div className="h-screen bg-gray-950 text-white font-sans selection:bg-blue-500/30 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-12 border-b border-gray-800 bg-gray-900/90 backdrop-blur-xl flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-800 p-1.5 rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.3)]">
            <Server size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-xs font-black tracking-[0.4em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300 leading-none drop-shadow-sm">Sentinel-3</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[7px] text-blue-400 font-bold uppercase tracking-widest drop-shadow-[0_0_5px_rgba(96,165,250,0.6)]">Tactical Operations</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
          {/* Hidden webcam elements for frame capture */}
          <video ref={webcamRef} className="hidden" playsInline muted />
          <canvas ref={webcamCanvasRef} className="hidden" />
          {callState.isActive && (
            <div className="flex items-center gap-2">
              {/* Webcam toggle button */}
              <button
                 onClick={isWebcamActive ? stopWebcam : startWebcam}
                 className={clsx(
                   "px-3 py-1.5 rounded-lg border font-bold text-[10px] tracking-widest uppercase active:scale-95 flex items-center gap-2 transition-all",
                   isWebcamActive
                     ? "border-green-500/50 bg-green-500/20 text-green-300 shadow-[0_0_15px_rgba(34,197,94,0.2)]"
                     : "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                 )}
              >
                 {isWebcamActive ? <Video size={13} className="animate-pulse" /> : <VideoOff size={13} />}
                 {isWebcamActive ? 'LIVE FEED ON' : 'Start Camera'}
              </button>
              {/* Photo upload fallback */}
              <button
                 onClick={() => fileInputRef.current?.click()}
                 className="px-2 py-1.5 rounded-lg border border-gray-700 bg-gray-800/50 text-gray-400 font-bold text-[10px] tracking-widest uppercase hover:bg-gray-700/50 active:scale-95 transition-all"
              >
                 <Camera size={13} />
              </button>
              {/* Webcam active indicator */}
              {isWebcamActive && (
                <div className="px-2 py-1 rounded border border-green-500/30 bg-green-900/20 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-[8px] text-green-400 font-mono uppercase">streaming</span>
                </div>
              )}
            </div>
          )}

          <div className="hidden lg:flex items-center gap-4 px-4 py-1.5 bg-black/60 rounded-full border border-gray-800 shadow-inner">
            <div className="w-32 h-6 flex items-center">
              <AudioVisualizer volume={volume} isActive={callState.isActive} />
            </div>
            <div className="flex gap-2 text-gray-700">
              <Globe size={12} className={location ? "text-blue-500" : ""} />
              <Activity size={12} className={callState.isActive ? "text-green-500 animate-pulse" : ""} />
              <BrainCircuit size={12} className={autonomousActions.some(a => a.status === 'pending') ? "text-purple-500 animate-spin-slow" : ""} />
            </div>
          </div>

          <button
            onClick={callState.isActive ? () => { stopWebcam(); clientRef.current?.disconnect(); } : startCall}
            disabled={callState.isConnecting}
            className={clsx(
              "px-6 py-1.5 rounded-lg font-black text-[10px] tracking-[0.2em] uppercase transition-all flex items-center gap-2 border shadow-lg active:scale-95 disabled:opacity-50",
              callState.isActive
                ? "bg-red-950/30 border-red-500/50 text-red-500 hover:bg-red-900/50"
                : "bg-blue-600 border-blue-400 text-white hover:bg-blue-500"
            )}
          >
            {callState.isActive ? 'END CALL' : callState.isConnecting ? 'CONNECTING...' : 'ENGAGE SYSTEM'}
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 flex gap-0.5 overflow-hidden h-full">

        {/* LEFT COLUMN: Strategic & Map */}
        <div className="flex-[3] flex flex-col bg-gray-900/50 border-r border-gray-800 h-full overflow-hidden">

          {/* Top Panel: Strategy & Triage */}
          <div className="h-[32%] flex border-b border-gray-800 overflow-hidden shrink-0">

            {/* Autonomous Actions Log (Left) */}
            <div className="flex-[3] border-r border-gray-800 p-4 bg-gray-900/80 relative overflow-y-auto scrollbar-hide">
              <div className="flex items-center gap-2 mb-2 text-purple-400 sticky top-0 bg-gray-900/80 backdrop-blur-sm py-1 z-10">
                <Radio size={14} />
                <span className="text-[9px] font-black uppercase tracking-[0.2em]">Autonomous Actions</span>
                {autonomousActions.some(a => a.status === 'pending') && <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-ping ml-2" />}
              </div>
              <div className="flex flex-col gap-1.5">
                {autonomousActions.length > 0 ? autonomousActions.slice(-8).map((action) => (
                  <div key={action.id} className="flex items-center gap-2 text-[10px]">
                    <div className={clsx("w-1.5 h-1.5 rounded-full shrink-0",
                      action.status === 'pending' ? "bg-yellow-500 animate-pulse" :
                        action.status === 'success' ? "bg-emerald-500" : "bg-red-500"
                    )} />
                    <span className="text-gray-400 text-[8px] font-mono">{action.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="text-purple-100/80 truncate">{action.action}</span>
                  </div>
                )) : (
                  <p className="text-[10px] text-gray-600 italic">System will log autonomous decisions here...</p>
                )}
              </div>
            </div>

            {/* Tactical Triage (Right) */}
            <div className="flex-[2] p-4 bg-black/20 flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 mb-3 text-emerald-400 shrink-0">
                <ShieldCheck size={14} />
                <span className="text-[9px] font-black uppercase tracking-[0.2em]">Tactical Triage</span>
              </div>
              <div className="flex flex-col gap-2 flex-1 overflow-y-auto scrollbar-hide">
                <div className="flex items-center justify-between bg-black/40 p-2 rounded border border-gray-800 shrink-0">
                  <span className="text-[9px] text-gray-500 uppercase tracking-widest">Threat Level</span>
                  <span className={clsx("text-[10px] font-black uppercase", callState.emergencyType ? "text-red-500" : "text-gray-600")}>
                    {callState.emergencyType || 'ANALYZING'}
                  </span>
                </div>

                {/* ACTION ERA: Interactive Actions */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <span className="text-[8px] text-blue-500 font-bold uppercase tracking-widest shrink-0">Smart City Commands</span>
                  <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto scrollbar-hide">
                    {callState.suggestedActions.length > 0 ? callState.suggestedActions.slice(0, 6).map((a, i) => {
                      const isExecuted = executedActions.has(a);
                      return (
                        <button
                          key={i}
                          onClick={() => handleExecuteAction(a)}
                          disabled={isExecuted}
                          className={clsx(
                            "border px-2 py-1 rounded text-[9px] font-bold uppercase tracking-tight transition-all flex items-center gap-1 shrink-0",
                            isExecuted
                              ? "bg-green-500/20 border-green-500/50 text-green-400 cursor-default"
                              : "bg-blue-500/10 border-blue-500/20 text-blue-300 hover:bg-blue-500/30 hover:border-blue-500 active:scale-95 cursor-pointer"
                          )}
                        >
                          {isExecuted ? <CheckCircle2 size={8} /> : <Play size={8} />}
                          <span className="truncate">{a}</span>
                        </button>
                      );
                    }) : <span className="text-[9px] text-gray-600 italic">No recommendations yet.</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Panel: Map with Overlay */}
          <div className="flex-1 relative bg-gray-950 min-h-0 pb-2">
            <LiveMap
              location={location}
              reconImage={reconImage}
              isGeneratingImage={isGeneratingImage}
              perimeterRadius={perimeterRadius}
              secondaryLocations={secondaryLocations}
              dispatchRoutes={dispatchRoutes}
              onVehicleArrived={(route) => {
                // When first vehicle arrives, regenerate image with responders
                if (!respondersImageGenerated.current) {
                  respondersImageGenerated.current = true;
                  const currentLoc = locationRef.current;
                  if (currentLoc) {
                    addLog(`${route.emoji} ${route.unitType.toUpperCase()} unit arrived on scene!`, 'system');
                    generateVisualRecon(currentLoc.address, true);
                  }
                }
              }}
            />

            {/* Map Overlay: Active Protocol (Dynamic RAG) */}
            {callState.incidentDetails.activeProtocol && (
              <div className="absolute top-4 right-4 z-[500] w-72 flex flex-col gap-2 pointer-events-none">
                <div className="bg-red-950/90 backdrop-blur-md border border-red-500/50 p-3 rounded-lg shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-top-4">
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-red-500/30">
                    <div className="flex items-center gap-2 text-red-400">
                      <ClipboardList size={14} />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em]">{callState.incidentDetails.activeProtocol.title}</span>
                    </div>
                    <div className="text-[8px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded animate-pulse">
                      ACTIVE
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {callState.incidentDetails.activeProtocol.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="min-w-[12px] h-[12px] bg-red-900/50 border border-red-500/30 rounded-sm flex items-center justify-center mt-0.5">
                          <span className="text-[8px] text-red-400">{i + 1}</span>
                        </div>
                        <p className="text-[10px] text-gray-200 font-medium leading-tight">{step.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Debrief & Logs */}
        <div className="w-[420px] flex flex-col bg-black border-l border-gray-800 shrink-0 h-full overflow-hidden">

          {/* Detailed Debrief (Gemini Flash) */}
          <div className="h-[40%] border-b border-gray-800 bg-gray-900/40 shrink-0 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 p-5 pb-2 text-cyan-400 shrink-0">
              <FileText size={14} />
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">Live Incident Board</span>
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto scrollbar-hide px-5 pt-1">
              <div className="space-y-4">
                {[
                  { label: "Situation Summary", val: callState.incidentDetails.situation, icon: AlertOctagon, color: 'text-red-400' },
                  { label: "Persons Involved", val: callState.incidentDetails.personsInvolved, icon: Zap, color: 'text-yellow-400' },
                  { label: "Active Threats", val: callState.incidentDetails.activeThreats, icon: ShieldAlert, color: 'text-orange-400' },
                  { label: "Infrastructure Status", val: callState.incidentDetails.infrastructureStatus, icon: Truck, color: 'text-blue-400' },
                ].map((item, i) => (
                  <div key={i} className="group relative">
                    <div className="absolute -inset-2 bg-gradient-to-r from-gray-900/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-lg -z-10" />
                    <div className="flex items-center gap-2 mb-1.5 opacity-80">
                      <item.icon size={12} className={item.color} />
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">{item.label}</span>
                    </div>
                    <div className="text-[11px] text-gray-200 font-medium leading-relaxed border-l-[3px] border-gray-800 pl-3 ml-1 group-hover:border-cyan-500/50 transition-colors line-clamp-2 shadow-sm">
                      {item.val}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Voice Tone Detection - Always visible at bottom */}
            <div className="px-5 py-3 border-t border-gray-800 bg-gray-900/60 shrink-0">
              <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500 mb-1 block">Voice Tone Detection</span>
              <div className="flex items-center gap-2">
                <div className={clsx("h-1.5 flex-1 rounded-full bg-gray-800 overflow-hidden relative")}>
                  <div className={clsx("absolute top-0 bottom-0 left-0 transition-all duration-500",
                    callState.callerTone === 'Panic' ? "bg-red-500 w-[95%]" :
                      callState.callerTone === 'Distressed' ? "bg-orange-500 w-[75%]" :
                        callState.callerTone === 'Urgent' ? "bg-yellow-500 w-[55%]" :
                          callState.callerTone === 'Controlled' ? "bg-blue-500 w-[35%]" :
                            callState.callerTone === 'Calm' ? "bg-emerald-500 w-[15%]" : "bg-gray-600 w-[50%]"
                  )} />
                </div>
                <span className="text-[9px] font-bold uppercase text-gray-300 w-20 text-right shrink-0">{callState.callerTone}</span>
              </div>
            </div>
          </div>

          {/* Transcript */}
          <div className="flex-1 bg-gray-950 relative min-h-0 overflow-hidden">
            <InfoPanel logs={logs} isConnecting={callState.isConnecting} />
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;
