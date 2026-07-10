import { Routes, Route } from "react-router-dom";

// Pages (stubs — will be built out in each phase)
import HomePage from "@/pages/HomePage.jsx";
import NotFoundPage from "@/pages/NotFoundPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      
      {/* Phase 2: Auth */}
      {/* <Route path="/login" element={<LoginPage />} /> */}
      {/* <Route path="/register" element={<RegisterPage />} /> */}

      {/* Phase 3: Dashboard & Rooms */}
      {/* <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} /> */}
      {/* <Route path="/room/:roomId" element={<RoomPage />} /> */}

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
