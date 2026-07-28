import { create } from "zustand";

import { createDeviceProvider } from "../device/createDeviceProvider";
import { MockDeviceProvider, type MockScenario } from "../device/MockDeviceProvider";
import type { DeviceProvider } from "../device/DeviceProvider";
import { DISCONNECTED_STATUS, type DeviceStatus } from "../device/types";
import { safeInvoke } from "../lib/tauri";
import { useLogStore } from "./logStore";

interface DeviceState {
  provider: DeviceProvider;
  /** True only when `provider` is the simulated dev-mode provider (no real hardware). */
  isMockProvider: boolean;
  status: DeviceStatus;
  busy: boolean;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  setMockScenario: (scenario: MockScenario) => void;
}

const provider = createDeviceProvider();

async function persistEvent(event: string, status: DeviceStatus) {
  await safeInvoke("record_device_event", {
    event,
    device: status.device,
    message: status.error?.message ?? null,
  });
}

function describeEventKind(status: DeviceStatus): string {
  switch (status.state) {
    case "connected":
    case "ready":
      return "connected";
    case "pairing-required":
      return "pairing-required";
    case "disconnected":
      return "disconnected";
    default:
      return "error";
  }
}

export const useDeviceStore = create<DeviceState>((set, get) => {
  provider.onStatusChange((status) => {
    set({ status, busy: status.state === "connecting" });
  });

  return {
    provider,
    isMockProvider: provider instanceof MockDeviceProvider,
    status: DISCONNECTED_STATUS,
    busy: false,

    connect: async () => {
      set({ busy: true });
      await provider.connect();
      const status = get().status;
      if (status.state === "connected" || status.state === "ready") {
        useLogStore.getState().log("info", `Device connected: ${status.device?.name}`, status.device?.model);
      } else if (status.state === "pairing-required") {
        useLogStore.getState().log("info", "Waiting for device trust", status.error?.message);
      } else if (status.error) {
        useLogStore.getState().log("error", "Device connection failed", status.error.message);
      }
      await persistEvent(describeEventKind(status), status);
    },

    disconnect: async () => {
      set({ busy: true });
      await provider.disconnect();
      useLogStore.getState().log("info", "Device disconnected");
      await persistEvent("disconnected", get().status);
    },

    reconnect: async () => {
      set({ busy: true });
      await provider.reconnect();
      const status = get().status;
      useLogStore.getState().log("info", "Device reconnect attempted", status.state);
      await persistEvent(describeEventKind(status), status);
    },

    setMockScenario: (scenario) => {
      if (provider instanceof MockDeviceProvider) provider.setScenario(scenario);
    },
  };
});
