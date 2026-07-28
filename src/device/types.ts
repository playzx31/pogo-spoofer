export interface DeviceInfo {
  udid: string;
  name: string;
  model: string;
  osVersion: string;
  connectionType: "usb" | "wifi" | "none";
  trusted: boolean;
}

export type DeviceConnectionState =
  | "disconnected"
  | "connecting"
  | "pairing-required"
  | "connected"
  | "ready"
  | "error";

export interface DeviceError {
  message: string;
  suggestedAction?: string;
}

export interface DeviceStatus {
  state: DeviceConnectionState;
  device: DeviceInfo | null;
  error: DeviceError | null;
  /** `undefined` = not checked yet; only set once a full `get_device_info` refresh has run. */
  developerModeEnabled?: boolean | null;
  developerDiskImageMounted?: boolean | null;
}

export const DISCONNECTED_STATUS: DeviceStatus = {
  state: "disconnected",
  device: null,
  error: null,
};
