export interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  sequence: number;
}

export interface UdpPacket {
  id: string;
  timestamp: string;
  payload: string;
  destination: string;
  status: 'sent' | 'blocked_watchdog' | 'waiting';
}

export interface AutopilotSimState {
  boatLat: number;
  boatLng: number;
  compassHeading: number; // Azimuth in degrees (0 - 360)
  targetWaypointIndex: number;
  waypoints: Waypoint[];
  isRecording: boolean;
  isPlaying: boolean;
  udpIp: string;
  udpPort: number;
  headingError: number; // calculated bearingTo - compassHeading
  distanceToTarget: number; // meters
  gpsUpdateRateHz: number; // Simulator GPS rate
  gpsLastUpdateTimestamp: number;
  watchdogStatus: 'ACTIVE' | 'WARNING' | 'TRIPPED';
  watchdogFeedbackMessage: string;
  packetsSentCount: number;
  rudderAngle: number; // -45 to +45
  simulationSpeed: number; // multiplier
}

export interface AndroidCodeFile {
  name: string;
  path: string;
  language: string;
  description: string;
  code: string;
}
