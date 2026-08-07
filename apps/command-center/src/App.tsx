import { Route, Routes } from "react-router-dom";
import { LocaleProvider } from "./i18n/LocaleContext";
import { LaunchPage } from "./routes/LaunchPage";
import { CommandCenterPage } from "./routes/CommandCenterPage";
import { ReplayLabPage } from "./routes/ReplayLabPage";
import { NotFoundPage } from "./routes/NotFoundPage";

export function App() {
  return (
    <LocaleProvider>
      <Routes>
        <Route path="/" element={<LaunchPage />} />
        <Route path="/session/:sessionId" element={<CommandCenterPage />} />
        <Route path="/replay/:sessionId" element={<ReplayLabPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </LocaleProvider>
  );
}
