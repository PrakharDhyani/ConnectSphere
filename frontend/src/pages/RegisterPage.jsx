import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api.js";
import { useAuthStore } from "@/stores/auth.store.js";
import AuthCard from "@/components/ui/AuthCard.jsx";
import Input from "@/components/ui/Input.jsx";
import Button from "@/components/ui/Button.jsx";

// Client-side mirror of the backend's Joi registerSchema — same rules, checked
// instantly for UX. The backend still enforces them (client checks are never
// security, the server can't trust us).
const schema = z
  .object({
    name: z.string().min(2, "At least 2 characters").max(100),
    email: z.string().email("Enter a valid email"),
    password: z
      .string()
      .min(8, "At least 8 characters")
      .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Needs an uppercase letter, a lowercase letter, and a number"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values) {
    setServerError(null);
    try {
      // eslint-disable-next-line no-unused-vars -- drop the confirm field, only send the rest
      const { confirmPassword, ...payload } = values;
      const res = await api.post("/auth/register", payload);
      setAuth(res.data.data); // registered users are logged in immediately
      navigate("/dashboard"); // dashboard shows the "verify your email" banner
    } catch (err) {
      setServerError(err.response?.data?.error?.message || "Registration failed — try again.");
    }
  }

  return (
    <AuthCard title="Create your account" subtitle="Join Groot">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input label="Username" type="text" placeholder="pick a unique name"
          error={errors.name?.message} {...register("name")} />
        <Input label="Email" type="email" placeholder="you@example.com"
          error={errors.email?.message} {...register("email")} />
        <Input label="Password" type="password" placeholder="Min 8 chars, Aa1"
          error={errors.password?.message} {...register("password")} />
        <Input label="Confirm password" type="password" placeholder="Re-enter your password"
          error={errors.confirmPassword?.message} {...register("confirmPassword")} />

        {serverError && <p className="text-sm text-red-400">{serverError}</p>}

        <Button type="submit" loading={isSubmitting} className="w-full">Sign up</Button>
      </form>

      <a href="/api/auth/google"
        className="mt-3 flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg
          bg-white text-gray-900 font-medium hover:bg-gray-200 transition-colors">
        Continue with Google
      </a>

      <p className="mt-6 text-sm text-gray-400 text-center">
        Already have an account?{" "}
        <Link to="/login" className="text-brand-400 hover:underline">Log in</Link>
      </p>
    </AuthCard>
  );
}
