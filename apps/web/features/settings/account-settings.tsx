"use client";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/account/session-provider";
import { logout } from "@parson/music-sdk";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { PasswordForm } from "./password-form";

export default function AccountSettings() {
  const { session, setSession } = useSession();
  const router = useRouter();
  const requestInFlight = useRef(false);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setSigningOut(true);
    try {
      await logout();
      setSession(null);
      router.replace("/login");
      router.refresh();
    } catch {
      toast("Could not log out. Try again.");
    } finally {
      requestInFlight.current = false;
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base font-semibold text-white">Username</h2>
        <p className="mt-2 text-sm text-zinc-300">{session?.username}</p>
      </section>
      <section className="border-t border-white/[0.08] pt-7">
        <h2 className="mb-4 text-base font-semibold text-white">
          Change password
        </h2>
        <PasswordForm />
      </section>
      <div className="border-t border-white/[0.08] pt-6">
        <Button
          disabled={signingOut}
          onClick={() => void signOut()}
          type="button"
          variant="outline"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Logging out…" : "Log out"}
        </Button>
      </div>
    </div>
  );
}
