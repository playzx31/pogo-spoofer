import type { DeviceProvider } from "./DeviceProvider";
import { DISCONNECTED_STATUS, type DeviceStatus } from "./types";

export type MockScenario = "trusted-ipad" | "untrusted-ipad" | "no-device" | "connection-error";

const SCENARIOS: Record<MockScenario, () => DeviceStatus> = {
  "trusted-ipad": () => ({
    state: "connected",
    device: {
      udid: "00008030-mock000000000001",
      name: "Kenneth's iPad",
      model: "iPad Pro (12.9-inch) (6th generation)",
      osVersion: "iPadOS 18.1",
      connectionType: "usb",
      trusted: true,
    },
    error: null,
  }),
  "untrusted-ipad": () => ({
    state: "error",
    device: {
      udid: "00008030-mock000000000002",
      name: "iPad",
      model: "iPad Pro (12.9-inch) (6th generation)",
      osVersion: "iPadOS 18.1",
      connectionType: "usb",
      trusted: false,
    },
    error: {
      message: "Device not trusted.",
      suggestedAction: "Unlock the iPad and tap \"Trust\" on the \"Trust This Computer?\" prompt.",
    },
  }),
  "no-device": () => ({
    state: "error",
    device: null,
    error: {
      message: "No device found on USB.",
      suggestedAction: "Connect the iPad/iPhone with a USB or USB-C cable and unlock it.",
    },
  }),
  "connection-error": () => ({
    state: "error",
    device: null,
    error: {
      message: "USB communication failed (simulated).",
      suggestedAction: "Unplug and reconnect the cable, then try again.",
    },
  }),
};

/**
 * Simulated device provider so the whole application can be developed and
 * demoed without a physical iPad/iPhone attached. Clearly labelled as
 * "Mock" everywhere it appears in the UI - it never claims to be a real
 * device connection.
 */
export class MockDeviceProvider implements DeviceProvider {
  readonly id = "Mock Device Provider";

  private status: DeviceStatus = DISCONNECTED_STATUS;
  private scenario: MockScenario = "trusted-ipad";
  private listeners = new Set<(status: DeviceStatus) => void>();

  setScenario(scenario: MockScenario) {
    this.scenario = scenario;
  }

  async connect(): Promise<void> {
    this.setStatus({ state: "connecting", device: null, error: null });
    await delay(600);
    this.setStatus(SCENARIOS[this.scenario]());
  }

  async disconnect(): Promise<void> {
    await delay(150);
    this.setStatus(DISCONNECTED_STATUS);
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async getStatus(): Promise<DeviceStatus> {
    return this.status;
  }

  onStatusChange(callback: (status: DeviceStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private setStatus(status: DeviceStatus) {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
