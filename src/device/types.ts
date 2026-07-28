export interface DeviceInfo {
  name: string;
  model: string;
  osVersion: string;
  connectionType: "usb" | "wifi" | "none";
  trusted: boolean;
}

export type DeviceConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface DeviceError {
  message: string;
  suggestedAction?: string;
}

export interface DeviceStatus {
  state: DeviceConnectionState;
  device: DeviceInfo | null;
  error: DeviceError | null;
}

export const DISCONNECTED_STATUS: DeviceStatus = {
  state: "disconnected",
  device: null,
  error: null,
};
