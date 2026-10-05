import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../styles.css";
import { HubApp } from "./HubApp";

createRoot(document.getElementById("root")!).render(<HubApp />);
