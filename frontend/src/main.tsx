import { createRoot } from "react-dom/client";
import App from "./app/App";
// ฟอนต์ bundle มากับเว็บ — Pi ของจอ Station ไม่มีอินเทอร์เน็ต ห้ามกลับไปใช้ Google Fonts (STATION_ACTIVITY.md ข้อ 5)
import "@fontsource/oswald/400.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/oswald/700.css";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles/index.css";
import { applyCachedBrandColor } from "./app/utils/brandColor";

applyCachedBrandColor();

createRoot(document.getElementById("root")!).render(<App />);
