import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { bootstrapAuth } from "@/lib/api.js";
import ProtectedRoute from "@/components/ProtectedRoute.jsx";

import HomePage from "@/pages/HomePage.jsx";
import LoginPage from "@/pages/LoginPage.jsx";
import RegisterPage from "@/pages/RegisterPage.jsx";
import AuthCallbackPage from "@/pages/AuthCallbackPage.jsx";
import EmailVerifiedPage from "@/pages/EmailVerifiedPage.jsx";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage.jsx";
import ResetPasswordPage from "@/pages/ResetPasswordPage.jsx";
import DashboardPage from "@/pages/DashboardPage.jsx";
import NotFoundPage from "@/pages/NotFoundPage.jsx";

export default function App() {
  // Once per app load: a reload wiped the in-memory access token, so ask
  // /refresh whether the httpOnly cookie session is still alive. Until this
  // resolves, ProtectedRoute shows a spinner instead of guessing.
  useEffect(() => {
    bootstrapAuth();
  }, []);

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/email-verified" element={<EmailVerifiedPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protected */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      {/* Phase 3: <Route path="/room/:roomId" element={<RoomPage />} /> */}

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
