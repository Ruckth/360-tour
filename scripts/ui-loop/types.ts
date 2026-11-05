export type Rect = { x: number; y: number; width: number; height: number };
export type Offender = {
  selector: string;
  text: string;
  rect: Rect;
  detail: string;
};
export type Check = {
  id: string;
  pass: boolean;
  value: unknown;
  total: number;
  offenders: Offender[];
  exempted: Offender[];
  warnings?: unknown[];
};
export type Blocked = {
  transport: "websocket" | "http";
  type: string;
  udfPath: string;
};
export type CaptureRecord = {
  screen: string;
  device: string;
  state: string;
  description: string;
  section: string;
  files: string[];
  checksFile?: string;
  checks?: Check[];
  url?: string;
  error?: string;
  pendingStates: string[];
  blocked: Blocked[];
  pointerCoarse?: boolean;
  websocketUrls: string[];
  guard: boolean;
};
export type Manifest = {
  version: 1;
  now: string;
  capturedAt: string;
  guard: string;
  captures: CaptureRecord[];
};
