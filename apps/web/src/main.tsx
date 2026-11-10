import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { startInstallCapture } from "./pwa/installStore";
import { registerPwa } from "./pwa/register";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerPwa();
startInstallCapture();
