import { connectVercelComputer, releaseVercelComputer } from './providers/vercel.js';

export interface Screenshot {
  base64: string;
  mediaType: 'image/png';
  width: number;
  height: number;
}

export interface Computer {
  screenshot(): Promise<Screenshot>;
  moveMouse(x: number, y: number): Promise<void>;
  click(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  type(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  hotkey(keys: string[]): Promise<void>;
}

export interface ComputerOptions {
  /** Trusted framework call ID, never model input. Required for physical actions. */
  callId?: string;
  /** Trusted test/operator configuration, never model input. */
  initialUrl?: string;
}

export async function getComputer(sessionId: string, options: ComputerOptions = {}): Promise<Computer> {
  return connectVercelComputer(sessionId, options);
}

/** Trusted lifecycle cleanup. Does not erase durable screenshots or revive compute. */
export async function releaseComputer(sessionId: string): Promise<void> {
  await releaseVercelComputer(sessionId);
}
