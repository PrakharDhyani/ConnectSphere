import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api.js";
import AuthCard from "@/components/ui/AuthCard.jsx";
import Input from "@/components/ui/Input.jsx";
import Button from "@/components/ui/Button.jsx";

// Same password policy as register (and the backend's resetPasswordSchema).
const schema = z
  .object({
    password: z
      .string()
      .min(8, "At least 8 characters")
      .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Needs an uppercase letter, a lowercase letter, and a number"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token"); // from the emailed link
  const [serverError, setServerError] = useState(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values) {
    setServerError(null);
    try {
      await api.post("/auth/reset-password", { token, password: values.password });
      // Reset revoked every session server-side — a fresh login is required.
      navigate("/login", {
        state: { message: "Password reset. Log in with your new password." },
      });
    } catch (err) {
      setServerError(err.response?.data?.error?.message || "Reset failed — try again.");
    }
  }

  if (!token) {
    return (
      <AuthCard title="Missing reset token" subtitle="Open this page from the link in your email.">
        <Link to="/forgot-password" className="text-brand-400 hover:underline text-sm">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input label="New password" type="password" placeholder="Min 8 chars, Aa1"
          error={errors.password?.message} {...register("password")} />
        <Input label="Confirm password" type="password" placeholder="Same again"
          error={errors.confirm?.message} {...register("confirm")} />

        {serverError && <p className="text-sm text-red-400">{serverError}</p>}

        <Button type="submit" loading={isSubmitting} className="w-full">Reset password</Button>
      </form>
    </AuthCard>
  );
}
