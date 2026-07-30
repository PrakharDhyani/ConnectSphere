import { useState } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api.js";
import { useAuthStore } from "@/stores/auth.store.js";
import AuthCard from "@/components/ui/AuthCard.jsx";
import Input from "@/components/ui/Input.jsx";
import Button from "@/components/ui/Button.jsx";

// Login only checks "present" — password RULES apply when creating one, not
// when checking an existing hash (mirrors the backend's loginSchema).
const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation(); // may carry a message from reset-password
  const [searchParams] = useSearchParams(); // ?error=oauth from Google failure
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values) {
    setServerError(null);
    try {
      const res = await api.post("/auth/login", values);
      setAuth(res.data.data); // { user, accessToken }
      navigate("/dashboard");
    } catch (err) {
      setServerError(err.response?.data?.error?.message || "Login failed — try again.");
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Log in to Groot">
      {location.state?.message && (
        <p className="mb-4 text-sm text-green-400 bg-green-950/50 border border-green-900 rounded-lg p-3">
          {location.state.message}
        </p>
      )}
      {searchParams.get("error") === "oauth" && (
        <p className="mb-4 text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-lg p-3">
          Google sign-in was cancelled or failed. Try again or use your password.
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input label="Email" type="email" placeholder="you@example.com"
          error={errors.email?.message} {...register("email")} />
        <Input label="Password" type="password" placeholder="••••••••"
          error={errors.password?.message} {...register("password")} />

        {serverError && <p className="text-sm text-red-400">{serverError}</p>}

        <Button type="submit" loading={isSubmitting} className="w-full">Log in</Button>
      </form>

      {/* Full-page navigation on purpose: OAuth is a redirect dance, not a fetch. */}
      <a href="/api/auth/google"
        className="mt-3 flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg
          bg-white text-gray-900 font-medium hover:bg-gray-200 transition-colors">
        Continue with Google
      </a>

      <div className="mt-6 flex justify-between text-sm text-gray-400">
        <Link to="/forgot-password" className="hover:text-brand-400">Forgot password?</Link>
        <Link to="/register" className="hover:text-brand-400">Create an account</Link>
      </div>
    </AuthCard>
  );
}
