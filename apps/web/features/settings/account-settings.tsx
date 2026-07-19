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
  const { setSession } = useSession();
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
      <PasswordForm />
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
