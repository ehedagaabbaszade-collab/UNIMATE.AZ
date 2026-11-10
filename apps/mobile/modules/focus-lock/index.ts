import { requireNativeModule } from 'expo-modules-core';

export type FocusLockStatus = {
  platform: 'ios' | 'android';
  supported: boolean;
  authorized: boolean;
  blockedCount: number;
  blocking: boolean;
  reason?: string;
};
export type FocusLockApp = { id: string; label: string };

interface NativeFocusLock {
  getStatus(): Promise<FocusLockStatus>;
  requestAuthorization(): Promise<boolean>;
  pickApps(): Promise<number>;
  listApps(): Promise<FocusLockApp[]>;
  setBlockedApps(ids: string[]): Promise<void>;
  startBlocking(endAtMs: number): Promise<boolean>;
  stopBlocking(): Promise<void>;
  pauseBlocking(): Promise<void>;
  resumeBlocking(endAtMs: number): Promise<boolean>;
}

let native: NativeFocusLock | null = null;
try {
  native = requireNativeModule<NativeFocusLock>('UnimateFocusLock');
} catch {
  native = null; // Expo Go / web / module not built into this binary
}

const unsupported = (reason: string): FocusLockStatus => ({
  platform: 'android',
  supported: false,
  authorized: false,
  blockedCount: 0,
  blocking: false,
  reason,
});

export const isAvailable = native !== null;

export async function getStatus(): Promise<FocusLockStatus> {
  if (!native) return unsupported('native_module_unavailable');
  try {
    return await native.getStatus();
  } catch (e) {
    return unsupported(e instanceof Error ? e.message : 'error');
  }
}
export const requestAuthorization = async (): Promise<boolean> =>
  native ? native.requestAuthorization() : false;
export const pickApps = async (): Promise<number> => (native ? native.pickApps() : 0);
export const listApps = async (): Promise<FocusLockApp[]> => (native ? native.listApps() : []);
export const setBlockedApps = async (ids: string[]): Promise<void> => {
  if (native) await native.setBlockedApps(ids);
};
export const startBlocking = async (endAtMs: number): Promise<boolean> =>
  native ? native.startBlocking(endAtMs) : false;
export const stopBlocking = async (): Promise<void> => {
  if (native) await native.stopBlocking();
};
export const pauseBlocking = async (): Promise<void> => {
  if (native) await native.pauseBlocking();
};
export const resumeBlocking = async (endAtMs: number): Promise<boolean> =>
  native ? native.resumeBlocking(endAtMs) : false;

export default {
  isAvailable,
  getStatus,
  requestAuthorization,
  pickApps,
  listApps,
  setBlockedApps,
  startBlocking,
  stopBlocking,
  pauseBlocking,
  resumeBlocking,
};
