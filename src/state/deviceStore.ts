import { create } from "zustand";

import { MockDeviceProvider, type MockScenario } from "../device/MockDeviceProvider";
import type { DeviceProvider } from "../device/DeviceProvider";
import { DISCONNECTED_STATUS, type DeviceStatus } from "../device/types";
import { safeInvoke } from "../lib/tauri";
import { useLogStore } from "./logStore";

interface DeviceState {
  provider: DeviceProvider;
  status: DeviceStatus;
  busy: boolean;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  setMockScenario: (scenario: MockScenario) => void;
}

const provider = new MockDeviceProvider();

async function persistEvent(event: string, status: DeviceStatus) {
  await safeInvoke("record_device_event", {
    event,
    device: status.device,
    message: status.error?.message ?? null,
  });
}

export const useDeviceStore = create<DeviceState>((set, get) => {
  provider.onStatusChange((status) => {
    set({ status, busy: status.state === "connecting" });
  });

  return {
    provider,
    status: DISCONNECTED_STATUS,
    busy: false,

    connect: async () => {
      set({ busy: true });
      await provider.connect();
      const status = get().status;
      if (status.state === "connected") {
        useLogStore.getState().log("info", `Device connected: ${status.device?.name}`, status.device?.model);
      } else if (status.error) {
        useLogStore.getState().log("error", "Device connection failed", status.error.message);
      }
      await persistEvent(status.state === "connected" ? "connected" : "error", status);
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
      await persistEvent("reconnect", status);
    },

    setMockScenario: (scenario) => provider.setScenario(scenario),
  };
});
