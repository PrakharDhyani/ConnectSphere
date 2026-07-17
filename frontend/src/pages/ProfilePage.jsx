import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api.js";
import { useAuthStore } from "@/stores/auth.store.js";
import Input from "@/components/ui/Input.jsx";
import Button from "@/components/ui/Button.jsx";

const schema = z.object({
  name: z.string().min(2, "At least 2 characters").max(100),
});

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const fileInput = useRef(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: user?.name ?? "" },
  });

  async function onSaveName(values) {
    setMessage(null);
    setError(null);
    try {
      const res = await api.patch("/users/me", values);
      setUser(res.data.data.user);
      setMessage("Profile saved.");
    } catch (err) {
      setError(err.response?.data?.error?.message || "Could not save — try again.");
    }
  }

  async function onAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setError(null);
    setUploading(true);
    try {
      // Files go as multipart/form-data, not JSON — FormData builds that body
      // and axios sets the Content-Type (with boundary) automatically.
      const form = new FormData();
      form.append("avatar", file);
      const res = await api.post("/users/me/avatar", form);
      setUser(res.data.data.user);
      setMessage("Avatar updated.");
    } catch (err) {
      setError(err.response?.data?.error?.message || "Upload failed — try again.");
    } finally {
      setUploading(false);
      e.target.value = ""; // allow re-selecting the same file
    }
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <Link to="/dashboard" className="text-xl font-bold text-brand-400">🌐 ConnectSphere</Link>
        <Link to="/dashboard" className="text-sm text-gray-400 hover:text-brand-400">← Back to dashboard</Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <h1 className="text-2xl font-bold">Your profile</h1>

        {/* Avatar */}
        <div className="flex items-center gap-5 bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="Your avatar"
              className="w-20 h-20 rounded-full object-cover border border-gray-700" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-brand-900 flex items-center justify-center
              text-2xl font-bold text-brand-200">
              {user?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div>
            <Button variant="secondary" loading={uploading}
              onClick={() => fileInput.current?.click()}>
              Change avatar
            </Button>
            <p className="text-xs text-gray-500 mt-2">JPEG, PNG or WebP · max 2MB</p>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={onAvatarChange} />
          </div>
        </div>

        {/* Name */}
        <form onSubmit={handleSubmit(onSaveName)}
          className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <Input label="Name" type="text" error={errors.name?.message} {...register("name")} />
          <div className="text-sm text-gray-500">
            Email: <span className="text-gray-300">{user?.email}</span>
            {user?.emailVerified ? (
              <span className="ml-2 text-green-400">verified ✓</span>
            ) : (
              <span className="ml-2 text-yellow-400">unverified</span>
            )}
          </div>

          {message && <p className="text-sm text-green-400">{message}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button type="submit" loading={isSubmitting}>Save changes</Button>
        </form>
      </main>
    </div>
  );
}
