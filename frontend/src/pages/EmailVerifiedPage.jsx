/**
 * Where the backend's GET /verify-email redirects after consuming the token:
 * .../email-verified?status=success | invalid
 */
import { Link, useSearchParams } from "react-router-dom";
import AuthCard from "@/components/ui/AuthCard.jsx";

export default function EmailVerifiedPage() {
  const [searchParams] = useSearchParams();
  const success = searchParams.get("status") === "success";

  return (
    <AuthCard
      title={success ? "Email verified 🎉" : "Link invalid or expired"}
      subtitle={
        success
          ? "Your account is fully activated."
          : "Verification links are single-use and expire after 24 hours."
      }
    >
      {success ? (
        <Link to="/dashboard"
          className="block text-center px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium">
          Go to dashboard
        </Link>
      ) : (
        <p className="text-sm text-gray-400">
          Log in and use the <span className="text-gray-200">resend verification</span> option
          on your dashboard to get a fresh link.
        </p>
      )}
    </AuthCard>
  );
}
