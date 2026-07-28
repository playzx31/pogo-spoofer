import { create } from "zustand";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  detail?: string;
  timestamp: string;
}

interface LogState {
  entries: LogEntry[];
  log: (level: LogLevel, message: string, detail?: string) => void;
}

const MAX_ENTRIES = 500;
let nextId = 1;

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  log: (level, message, detail) => {
    const entry: LogEntry = { id: nextId++, level, message, detail, timestamp: new Date().toISOString() };
    const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleFn(`[${level}] ${message}`, detail ?? "");
    set((state) => ({ entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) }));
  },
}));
