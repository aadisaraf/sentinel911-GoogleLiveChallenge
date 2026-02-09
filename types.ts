
export interface LocationData {
  address: string;
  lat: number;
  lng: number;
  confidence?: string;
}

export interface ProtocolStep {
  id: string;
  text: string;
  status: 'pending' | 'completed';
}

export interface ActiveProtocol {
  title: string;
  steps: ProtocolStep[];
}

export interface IncidentDetails {
  situation: string;
  personsInvolved: string;
  weapons: string;
  activeThreats: string; // Renamed from hazards
  infrastructureStatus: string; // Renamed from medicalNeeds
  suggestedActions: string[];
  suggestedQuestions: string[];
  tone?: string;
  emergencyType?: string;
  activeProtocol?: ActiveProtocol | null;
}

export interface CallState {
  isActive: boolean;
  isConnecting: boolean;
  callerTone: string;
  emergencyType: string;
  summary: string;
  suggestedActions: string[];
  suggestedQuestions: string[];
  incidentDetails: IncidentDetails;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  source: 'user' | 'assistant' | 'system';
  text: string;
}

export interface AudioVisualizerState {
  volume: number;
}
