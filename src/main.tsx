import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import "./styles/theme.css";
import { isTauri } from "./lib/tauri";

// Mirrors frontend console.* output (including uncaught errors) into the
// Rust logger, so issues are visible in the same log file/terminal used for
// backend diagnostics instead of only an inaccessible webview console.
if (isTauri()) void attachConsole();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
