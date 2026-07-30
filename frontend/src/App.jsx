import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { bootstrapAuth } from "@/lib/api.js";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { useNotify } from "@/stores/notify.store.js";
import ProtectedRoute from "@/components/ProtectedRoute.jsx";
import PublicOnlyRoute from "@/components/PublicOnlyRoute.jsx";
import Toaster from "@/components/Toaster.jsx";

import HomePage from "@/pages/HomePage.jsx";
import LoginPage from "@/pages/LoginPage.jsx";
import RegisterPage from "@/pages/RegisterPage.jsx";
import AuthCallbackPage from "@/pages/AuthCallbackPage.jsx";
import EmailVerifiedPage from "@/pages/EmailVerifiedPage.jsx";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage.jsx";
import ResetPasswordPage from "@/pages/ResetPasswordPage.jsx";
import JoinPage from "@/pages/JoinPage.jsx";
import DashboardPage from "@/pages/DashboardPage.jsx";
import ProfilePage from "@/pages/ProfilePage.jsx";
import FriendsPage from "@/pages/FriendsPage.jsx";
import RoomPage from "@/pages/RoomPage.jsx";
import NotFoundPage from "@/pages/NotFoundPage.jsx";

export default function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const isGuest = useAuthStore((s) => s.user?.isGuest);
  const push = useNotify((s) => s.push);

  // Once per app load: a reload wiped the in-memory access token, so ask
  // /refresh whether the httpOnly cookie session is still alive.
  useEffect(() => {
    bootstrapAuth();
  }, []);

  // App-wide socket for friend events — so a friend request / invite pops a
  // toast on ANY page, not only inside a room. Registered users only.
  useEffect(() => {
    if (status !== "authed" || isGuest) return;
    const socket = connectSocket();

    const onInvite = ({ from, room }) =>
      push({
        title: `${from.name} invited you to “${room.name}”`,
        actionLabel: "Join",
        action: () => navigate(`/join/${room.code}`),
      });
    const onRequest = ({ from }) => {
      push({ title: `${from.name} sent you a friend request`, actionLabel: "View", action: () => navigate("/friends") });
      queryClient.invalidateQueries({ queryKey: ["friend-requests"] });
    };
    const onAccepted = ({ by }) => {
      push({ title: `${by.name} accepted your friend request` });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
    };

    socket.on("friend:invite", onInvite);
    socket.on("friend:request", onRequest);
    socket.on("friend:accepted", onAccepted);
    return () => {
      getSocket().off("friend:invite", onInvite);
      getSocket().off("friend:request", onRequest);
      getSocket().off("friend:accepted", onAccepted);
    };
  }, [status, isGuest, navigate, queryClient, push]);

  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/" element={<HomePage />} />

        {/* Auth */}
        <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/email-verified" element={<EmailVerifiedPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/join/:code" element={<JoinPage />} />

        {/* Protected */}
        <Route path="/dashboard" element={<ProtectedRoute fullUserOnly><DashboardPage /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute fullUserOnly><ProfilePage /></ProtectedRoute>} />
        <Route path="/friends" element={<ProtectedRoute fullUserOnly><FriendsPage /></ProtectedRoute>} />
        <Route path="/room/:roomId" element={<ProtectedRoute><RoomPage /></ProtectedRoute>} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
