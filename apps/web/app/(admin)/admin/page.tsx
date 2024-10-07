"use client"

import { useEffect } from "react";
import getSession from "@/lib/Authentication/JWT/getSession";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/Providers/AuthProvider";

export default function AdminPage() {
  const { session } = useSession()
  const { push } = useRouter();

  useEffect(() => {

    if (session?.role !== "admin") {
      push("/home");
    }
  }, [push, session?.role]);

  return (
    <h1 className="text-white text-3xl flex justify-center min-h-screen">You are admin!</h1>
  );
}