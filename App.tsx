
import React, { useState, useCallback, useRef, useEffect } from 'react';
import LiveMap, { SecondaryLocation, DispatchRoute } from './components/LiveMap';
import InfoPanel from './components/InfoPanel';
import AudioVisualizer from './components/AudioVisualizer';
import { LocationData, CallState, LogEntry, IncidentDetails, ProtocolStep } from './types';
import { LiveClient } from './services/liveClient';
import { GoogleGenAI, Type } from '@google/genai';
import { Siren, Activity, ShieldCheck, BrainCircuit, Globe, Zap, Mic, FileText, AlertOctagon, CheckCircle2, Play, ClipboardList, Server, Radio, Truck } from 'lucide-react';
import clsx from 'clsx';

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

  const clientRef = useRef<LiveClient | null>(null);
  const transcriptRef = useRef<string>("");
  const lastSourceRef = useRef<LogEntry['source'] | null>(null);
  const locationRef = useRef<LocationData | null>(null);

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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

      const basePrompt = withResponders
        ? `Generate a photorealistic aerial drone photograph looking straight down at this location: "${address}". 

Requirements:
- FULL COLOR image, NOT black and white
- Bird's eye / top-down drone perspective from about 200 feet altitude
- Show the street, buildings, rooftops, parked cars, trees
- Daytime with natural lighting and shadows
- INCLUDE emergency vehicles at the scene: fire trucks with flashing lights, police cars with sirens, ambulances  
- Show firefighters near the building, hoses deployed
- Show police cars blocking the street forming a perimeter
- The scene should look like an ACTIVE emergency response in progress
- Realistic urban/suburban environment with detail
- Include a visible street sign or text overlay showing: "${address}"`
        : `Generate a photorealistic aerial drone photograph looking straight down at this location: "${address}". 

Requirements:
- FULL COLOR image, NOT black and white
- Bird's eye / top-down drone perspective from about 200 feet altitude
- Show the street, buildings, rooftops, parked cars, trees
- Daytime with natural lighting and shadows
- DO NOT include any emergency vehicles, police, firefighters, or officials
- DO NOT include any people in uniform
- The scene should look like a normal neighborhood BEFORE emergency response arrives
- Realistic urban/suburban environment with detail
- Include a visible street sign or text overlay showing: "${address}"`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: basePrompt }] },
        config: {
          responseModalities: ['Text', 'Image'],
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: "1K"
          }
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64String = part.inlineData.data;
          setReconImage(`data:image/png;base64,${base64String}`);
          addLog(withResponders
            ? `Visual updated: First responders on scene at ${address}`
            : `Drone uplink established for sector: ${address}`, 'system');
          break;
        }
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
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `Analyze this 911 transcript and extract information.
           
           VOICE TONE ANALYSIS (CRITICAL):
           - Carefully analyze the caller's emotional state from their language
           - Look for: urgency words, exclamations, panic indicators, calmness
           - "Help! Fire! Screaming!" = Panic
           - "There's an emergency, people trapped" = Distressed  
           - "I need to report an incident" = Urgent
           - "The situation is under control now" = Controlled
           - "Everything is fine, thank you" = Calm
           
           TACTICAL LOGISTICS:
           - Focus on INFRASTRUCTURE and CONTAINMENT (Fire Evac, Grid Lockdown, Traffic Control)
           - infrastructureStatus: report on Roads, Power Grid, Structure Integrity
           - DO NOT PROVIDE MEDICAL ADVICE
           
           TRANSCRIPT: ${transcriptRef.current}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                situation: { type: Type.STRING },
                personsInvolved: { type: Type.STRING },
                weapons: { type: Type.STRING },
                activeThreats: { type: Type.STRING },
                infrastructureStatus: { type: Type.STRING, description: "Status of nearby infra (Power, Traffic, Structures)" },
                tone: { type: Type.STRING, enum: ["Panic", "Distressed", "Urgent", "Controlled", "Calm"], description: "Caller's emotional state based on language analysis" },
                emergencyType: { type: Type.STRING },
                suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Smart City Commands (e.g. 'Lockdown Sector A', 'Deploy Drones')" },
                suggestedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                activeProtocol: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: "Name of the protocol (e.g. Structural Evac)" },
                    steps: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          text: { type: Type.STRING },
                          status: { type: Type.STRING, enum: ['pending', 'completed'] }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        });
        const json = JSON.parse(response.text) as IncidentDetails;

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
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

        // Ask Gemini 3 Flash to decide on autonomous actions
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `You are an AUTONOMOUS emergency dispatcher AI. Based on the current incident, decide if ANY proactive actions should be taken NOW.

CURRENT INCIDENT STATE:
- Situation: ${callState.summary}
- Emergency Type: ${callState.emergencyType || 'Unknown'}
- Threat Level: ${callState.incidentDetails.activeThreats}
- Infrastructure: ${callState.incidentDetails.infrastructureStatus}
- Persons: ${callState.incidentDetails.personsInvolved}

ACTIONS ALREADY TAKEN (do NOT repeat):
${autonomousActions.map(a => `- ${a.action}`).join('\n') || '- None yet'}

Decide if you should proactively take ONE of these actions NOW:
1. dispatch_backup - Deploy additional units if situation is escalating
2. expand_perimeter - Widen the lockdown area for safety
3. request_air_support - Call for helicopter if needed
4. notify_hospitals - Alert nearby hospitals of incoming casualties
5. none - No action needed right now

Respond with JSON. Only suggest an action if it's CLEARLY needed and NOT already taken.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                shouldAct: { type: Type.BOOLEAN, description: "Whether to take action" },
                action: { type: Type.STRING, description: "Action to take" },
                reason: { type: Type.STRING, description: "Why this action is needed" },
                details: { type: Type.STRING, description: "Specific details for the action" }
              }
            }
          }
        });

        const decision = JSON.parse(response.text) as {
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
  }, [callState.isActive, callState.summary, callState.emergencyType, callState.incidentDetails, autonomousActions]);

  // Helper to add autonomous action log
  const addAutonomousAction = useCallback((action: string, status: 'pending' | 'success' | 'failed' = 'pending') => {
    const id = Math.random().toString(36).substring(7);
    setAutonomousActions(prev => [...prev, { id, action, status, timestamp: new Date() }]);
    return id;
  }, []);

  const updateAutonomousAction = useCallback((id: string, status: 'success' | 'failed') => {
    setAutonomousActions(prev => prev.map(a => a.id === id ? { ...a, status } : a));
  }, []);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const delta = 0.1;
          const viewbox = `${longitude - delta},${latitude + delta},${longitude + delta},${latitude - delta}`;
          const policeUrl = `${NOMINATIM_BASE_URL}/search?q=police+station&viewbox=${viewbox}&bounded=1&limit=1`;
          const policeData = await safeFetch(policeUrl);

          if (Array.isArray(policeData) && policeData[0]) {
            const station = policeData[0];
            setLocation({
              address: `[STATION HQ] ${station.display_name.split(',')[0]}`,
              lat: parseFloat(station.lat),
              lng: parseFloat(station.lon),
              confidence: 'Station Lock'
            });
            return;
          }
        } catch (e) {
          console.warn("Police station search failed", e);
        }
        setLocation({
          address: `Sector Grid: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          lat: latitude,
          lng: longitude,
          confidence: 'GPS Signal'
        });
      }, () => {
        setLocation({ address: "Central Command [Default]", lat: 40.7128, lng: -74.0060, confidence: 'Default' });
      });
    }
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
        // Format tool call for display
        const toolLabels: Record<string, string> = {
          'set_location': `📍 Location Lock: ${args.address}`,
          'dispatch_unit': `🚨 Dispatch ${args.unitType?.toUpperCase()} → ${args.location}`,
          'lockdown_sector': `🔒 Lockdown ${args.sectorId} (${args.level})`,
          'deploy_drones': `🛸 Deploy ${args.count} drone(s) → ${args.location}`,
          'generate_report': `📋 Report: ${args.incidentType}`,
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
          <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg">
            <Server size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-xs font-black tracking-[0.4em] uppercase text-white leading-none">Sentinel-3</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[7px] text-blue-400 font-bold uppercase tracking-widest">Tactical Operations</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-4 px-4 py-1.5 bg-black/60 rounded-full border border-gray-800">
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
            onClick={callState.isActive ? () => clientRef.current?.disconnect() : startCall}
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
            <div className="flex-1 overflow-y-auto scrollbar-hide px-5">
              <div className="space-y-3">
                {[
                  { label: "Situation Summary", val: callState.incidentDetails.situation, icon: AlertOctagon },
                  { label: "Persons Involved", val: callState.incidentDetails.personsInvolved, icon: Zap },
                  { label: "Active Threats", val: callState.incidentDetails.activeThreats, icon: ShieldCheck },
                  { label: "Infrastructure Status", val: callState.incidentDetails.infrastructureStatus, icon: Truck },
                ].map((item, i) => (
                  <div key={i} className="group">
                    <div className="flex items-center gap-2 mb-1 opacity-60">
                      <item.icon size={10} className="text-gray-400" />
                      <span className="text-[8px] font-bold uppercase tracking-widest text-gray-400">{item.label}</span>
                    </div>
                    <div className="text-[10px] text-gray-200 font-medium leading-snug border-l-2 border-gray-700 pl-2 ml-1 group-hover:border-cyan-500/50 transition-colors line-clamp-2">
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
