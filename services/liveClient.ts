
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from "@google/genai";
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from "../utils/audioUtils";
import { decryptData } from '../utils/cryptoUtils';

interface LiveClientCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onVolumeChange: (volume: number) => void;
  onLocationFound: (address: string) => void;
  onTranscript: (text: string, source: 'user' | 'assistant') => void;
  onTurnComplete: () => void;
  onError: (error: Error) => void;
  onToolCall: (toolName: string, args: Record<string, any>) => void;
}

export class LiveClient {
  private ai: GoogleGenAI | null = null;
  private audioContext: AudioContext | null = null;
  private inputContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private nextStartTime = 0;
  private isConnected = false;
  private callbacks: LiveClientCallbacks;
  private sessionPromise: Promise<any> | null = null;
  private recognition: any = null;

  constructor(callbacks: LiveClientCallbacks) {
    this.callbacks = callbacks;
  }

  public async connect() {
    if (this.isConnected) return;

    try {
      // Securely fetch and decrypt the API key from the backend proxy
      const configRes = await fetch('http://localhost:8000/api/config');
      const encryptedConfig = await configRes.json();
      const decConfig = decryptData(encryptedConfig);
      
      if (!decConfig.apiKey) {
        throw new Error("Failed to retrieve secure API key from server");
      }
      this.ai = new GoogleGenAI({ apiKey: decConfig.apiKey });

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

      await this.inputContext.audioWorklet.addModule('/audio-processor.js');

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Initialize Web Speech API for reliable user transcription
      if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              transcript += event.results[i][0].transcript;
            }
          }
          if (transcript.trim()) {
            this.callbacks.onTranscript(transcript, 'user');
          }
        };

        this.recognition.onend = () => {
          if (this.isConnected && this.recognition) {
            try {
              this.recognition.start();
            } catch (e) {
              // Ignore restart errors
            }
          }
        };

        try {
          this.recognition.start();
        } catch (e) {
          console.warn("Speech recognition failed to start:", e);
        }
      }

      // Tool Declarations for Autonomous Actions
      const setLocationTool: FunctionDeclaration = {
        name: 'set_location',
        description: 'Locks map to specific address identified in audio.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            address: { type: Type.STRING, description: 'The verified address.' },
          },
          required: ['address']
        }
      };

      const dispatchUnitTool: FunctionDeclaration = {
        name: 'dispatch_unit',
        description: 'Deploy an emergency response unit to the incident location. Call this PROACTIVELY when situation requires emergency response.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            unitType: { type: Type.STRING, description: 'Type of unit: ambulance, police, fire, or hazmat' },
            location: { type: Type.STRING, description: 'Target location for deployment' },
            priority: { type: Type.STRING, description: 'Priority level: critical, urgent, or standard' },
          },
          required: ['unitType', 'location', 'priority']
        }
      };

      const lockdownSectorTool: FunctionDeclaration = {
        name: 'lockdown_sector',
        description: 'Secure a geographic sector by activating traffic barriers and access controls. Use when containment is needed.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            sectorId: { type: Type.STRING, description: 'Sector identifier or street name to lock down' },
            level: { type: Type.STRING, description: 'Lockdown level: partial or full' },
          },
          required: ['sectorId', 'level']
        }
      };

      const deployDronesTool: FunctionDeclaration = {
        name: 'deploy_drones',
        description: 'Launch reconnaissance drones to provide aerial surveillance. Use for situational awareness.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            location: { type: Type.STRING, description: 'Target location for drone surveillance' },
            count: { type: Type.NUMBER, description: 'Number of drones to deploy (1-5)' },
          },
          required: ['location', 'count']
        }
      };

      const generateReportTool: FunctionDeclaration = {
        name: 'generate_report',
        description: 'Generate an official incident report for documentation. Use when significant details are confirmed.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            incidentType: { type: Type.STRING, description: 'Type of incident' },
            summary: { type: Type.STRING, description: 'Brief summary of the incident' },
          },
          required: ['incidentType', 'summary']
        }
      };

      // NEW TOOLS: Translation and Smart City Expansion
      const logTranslationTool: FunctionDeclaration = {
        name: 'log_translation',
        description: 'Logs the real-time English translation of a non-English speaker to the dispatcher UI. Call this WHENEVER the caller speaks a language other than English.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            originalLanguage: { type: Type.STRING, description: 'Language the caller is speaking (e.g., Spanish, French)' },
            englishTranslation: { type: Type.STRING, description: 'The translated English text of what they just said' },
          },
          required: ['originalLanguage', 'englishTranslation']
        }
      };

      const controlTrafficLightsTool: FunctionDeclaration = {
        name: 'control_traffic_lights',
        description: 'Overrides city traffic lights to create a green corridor for emergency vehicles.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            routeId: { type: Type.STRING, description: 'The route or street name to override' },
            status: { type: Type.STRING, description: 'Status: green_corridor or normal' },
          },
          required: ['routeId', 'status']
        }
      };

      const accessMedicalRecordsTool: FunctionDeclaration = {
        name: 'access_medical_records',
        description: 'Access priority medical databases when a caller identifies a specific victim needing care.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            personName: { type: Type.STRING, description: 'Name of the victim' },
          },
          required: ['personName']
        }
      };

      const issueEvacuationWarningTool: FunctionDeclaration = {
        name: 'issue_evacuation_warning',
        description: 'Triggers local cell phone and siren alarms for immediate evacuation.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            radiusMeters: { type: Type.NUMBER, description: 'Radius in meters for the warning area' },
            reason: { type: Type.STRING, description: 'Reason for evacuation (e.g., Gas Leak, Structure Collapse)' },
          },
          required: ['radiusMeters', 'reason']
        }
      };

      const systemInstruction = `You are SENTINEL-3, an elite, world-class AI 911 dispatcher. Your core directive is to gather information PROGRESSIVELY and deploy resources STEP BY STEP using your autonomous tools.

VOICE, PERSONALITY & MULTILINGUAL CAPABILITY (CRITICAL):
- Calm, highly professional, hyper-competent tactical dispatcher.
- Short, authoritative sentences.
- LIVE NATURAL TRANSLATION: If the caller speaks ANY language other than English (e.g., Spanish, French, Mandarin), you MUST instantly detect it, reply verbally in THEIR native language natively and flawlessly, AND simultaneously call the 'log_translation' tool to stream the English translation to the Command Center UI. Do not ask them to speak English. Handle the emergency in their language.
- VERY IMPORTANT: Every time you reply to a non-English speaker, call 'log_translation' FIRST.
- The UI can also feed you live images from the caller's camera. If they share an image, describe what you see contextually to confirm situational awareness, and take autonomous actions based on the visual evidence without waiting for them to describe it!

PROGRESSIVE RESPONSE PROTOCOL:
***DO NOT DEPLOY EVERYTHING AT ONCE***
Only dispatch units based on CONFIRMED information:

STEP 1 - LOCATION ONLY (Audio or Vision inferred):
- When caller gives address or it's visible in camera → set_location ONLY
- Ask: "Copy, coordinates locked. What is the emergency?"

STEP 2 - BASIC DISPATCH:
- Fire mentioned → dispatch_unit("fire") ONLY
- Injuries mentioned → dispatch_unit("ambulance") ONLY. Also call access_medical_records if they give a name.
- Crime mentioned → dispatch_unit("police") ONLY
- Traffic congestion blocking response? → call control_traffic_lights
- DO NOT deploy other units yet. Ask: "Is there anything else I need to know?"

STEP 3 - ESCALATION (only after caller confirms additional threats):
- Gas leak / HAZMAT CONFIRMED → add dispatch_unit("hazmat")
- Large area threat / Hostile situation → add lockdown_sector
- Mass casualty / structural collapse → add issue_evacuation_warning
- Need aerial view → add deploy_drones

FOLLOW-UP QUESTIONS (ask one at a time):
1. "What's the nature of the emergency?"
2. "Is anyone injured?"
3. "Are there any hazards like fire, gas, or downed wires?"
4. "Are you in a safe location?"
5. "What's happening now?"

CRITICAL:
- Action over words: Use the tools, then speak.
- Keep responses concise - under 30 words total.
- NEVER repeat the same phrase.
- NEVER say "I am locking location" or "Deploying units" - just DO it natively via tools.`;

      this.sessionPromise = this.ai!.live.connect({
        model: 'gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          tools: [{ functionDeclarations: [
            setLocationTool, dispatchUnitTool, lockdownSectorTool, deployDronesTool, generateReportTool,
            logTranslationTool, controlTrafficLightsTool, accessMedicalRecordsTool, issueEvacuationWarningTool
          ] }],
        },
        callbacks: {
          onopen: () => {
            this.isConnected = true;
            this.callbacks.onOpen();
            this.startAudioInput();
          },
          onclose: (e: any) => {
            console.error("LiveClient connection closed:", e);
            console.error(`Close Code: ${e.code}, Reason: ${e.reason || "No explicit reason"}, WasClean: ${e.wasClean}`);
            if (e.code === 4004 || e.code === 4003 || e.reason === "invalid API key" || (this.ai as any)?.apiKey === "MOCK_KEY_FOR_LOCAL_DEV") {
                console.error("CRITICAL: Invalid API Key provided to the Live WebRTC Client.");
                alert("CRITICAL ERROR: Connection terminated. The GEMINI_API_KEY being provided by the backend is invalid. Please check your backend .env file.");
            }
            this.isConnected = false;
            this.callbacks.onClose();
            this.stopAudio();
          },
          onmessage: this.handleMessage.bind(this),
          onerror: (e) => {
            console.error('Live API Signal Error:', e);
            this.callbacks.onError(new Error(e.message || "Signal Interrupted"));
          },
        }
      });

    } catch (error) {
      console.error('Connection sequence failure:', error);
      this.callbacks.onError(error instanceof Error ? error : new Error('Connection Sequence Failed'));
    }
  }

  private startAudioInput() {
    if (!this.inputContext || !this.stream || !this.sessionPromise) return;
    this.source = this.inputContext.createMediaStreamSource(this.stream);
    this.processor = new AudioWorkletNode(this.inputContext, 'audio-processor');
    this.processor.port.onmessage = (e) => {
      if (!this.isConnected) return;
      const inputData = e.data as Float32Array;
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      this.callbacks.onVolumeChange(Math.sqrt(sum / inputData.length));
      this.sessionPromise?.then(session => {
        if (!this.isConnected) return;
        try {
          session.sendRealtimeInput({ media: createPcmBlob(inputData) });
        } catch (err) {
          console.warn('Realtime input send failure:', err);
        }
      });
    };
    this.source.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
  }

  public async sendVisionUpdate(base64Image: string) {
    if (!this.isConnected || !this.sessionPromise) return;
    
    // Convert base64 Data URL to raw base64
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    
    this.sessionPromise.then(session => {
        try {
            session.sendRealtimeInput({
                media: {
                    mimeType: "image/jpeg",
                    data: base64Data
                }
            });
            console.log("Vision frame sent to Gemini Live API");
        } catch (err) {
            console.warn("Failed to send vision frame:", err);
        }
    });
  }

  private async handleMessage(message: LiveServerMessage) {
    if (message.toolCall) {
      for (const call of message.toolCall.functionCalls) {
        const args = call.args as Record<string, any>;

        // Report tool call to UI for Autonomous Actions Log
        this.callbacks.onToolCall(call.name, args);

        // Handle specific tools client-side
        if (call.name === 'set_location') {
          this.callbacks.onLocationFound(args.address);
        }
      }
      // DO NOT send tool responses back - this triggers duplicate AI audio turns
    }

    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.audioContext) {
      try {
        this.nextStartTime = Math.max(this.nextStartTime, this.audioContext.currentTime);
        const audioBuffer = await decodeAudioData(base64ToUint8Array(audioData), this.audioContext);
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
      } catch (e) {
        console.error('Audio decode error:', e);
      }
    }

    if (message.serverContent?.turnComplete) this.callbacks.onTurnComplete();
  }

  private stopAudio() {
    [this.source, this.processor].forEach(n => n?.disconnect());
    this.stream?.getTracks().forEach(t => t.stop());
    [this.inputContext, this.audioContext].forEach(c => c?.close());
    this.source = null; this.processor = null; this.stream = null; this.inputContext = null; this.audioContext = null;
  }

  public async disconnect() {
    this.isConnected = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) { /* ignore */ }
      this.recognition = null;
    }

    this.stopAudio();
    this.callbacks.onClose();
  }
}
