import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api.js";
import AuthCard from "@/components/ui/AuthCard.jsx";
import Input from "@/components/ui/Input.jsx";
import Button from "@/components/ui/Button.jsx";

const schema = z.object({ email: z.string().email("Enter a valid email") });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values) {
    // The API answers the same 200 whether or not the account exists
    // (anti-enumeration) — so the UI can only ever say "check your inbox".
    await api.post("/auth/forgot-password", values).catch(() => {});
    setSent(true);
  }

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a reset link">
      {sent ? (
        <p className="text-sm text-green-400 bg-green-950/50 border border-green-900 rounded-lg p-3">
          If an account exists for that email, a reset link is on its way.
          The link expires in 1 hour.
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Input label="Email" type="email" placeholder="you@example.com"
            error={errors.email?.message} {...register("email")} />
          <Button type="submit" loading={isSubmitting} className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-6 text-sm text-gray-400 text-center">
        <Link to="/login" className="text-brand-400 hover:underline">Back to login</Link>
      </p>
    </AuthCard>
  );
}
