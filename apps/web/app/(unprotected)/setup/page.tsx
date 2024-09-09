import { Button } from "@music/ui/components/button";
import Link from "next/link";

export default function Setup() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <p className="text text-center text-4xl py-14 text-white">Setup ParsonLabs Music</p>
      <div className="flex flex-col items-center justify-center">
        <Link href="/setup/server" className="flex items-center justify-center">
          <Button className="w-full px-6 py-4 mt-6 text-lg text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
            Get Started
          </Button>
        </Link>
      </div>
    </div>
  );
}