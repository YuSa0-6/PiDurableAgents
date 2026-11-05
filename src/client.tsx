// Browser entry: mounts the app. The components live in ./ui so tests can
// import them without rendering into the page.
import { createRoot } from "react-dom/client";
import { App } from "./ui/app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
