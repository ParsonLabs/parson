"use client"

import { useEffect } from "react";
import getSession from "@/lib/Authentication/JWT/getSession";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const { push } = useRouter();

  useEffect(() => {
    const session = getSession();
    if (session?.role !== "admin") {
      push("/home");
    }
  }, [push]);

  return (
    <h1 className="text-white text-3xl flex justify-center min-h-screen">You are admin!</h1>
  );
}