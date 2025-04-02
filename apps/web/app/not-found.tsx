"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@music/ui/components/button";
import { Home, ArrowLeft, Disc3 } from "lucide-react";
import { useEffect, useState } from "react";

export default function NotFoundPage() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);
  
  useEffect(() => {
    if (countdown <= 0) {
      router.push("/");
      return;
    }
    
    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [countdown, router]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center">
          <motion.div 
            initial={{ rotate: 0 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="mx-auto relative w-32 h-32 mb-8"
          >
            <Disc3 className="w-full h-full text-purple-500/80" strokeWidth={1} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-white" />
            </div>
          </motion.div>
          
          <motion.h1 
            className="text-7xl md:text-9xl font-bold text-white mb-4"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            404
          </motion.h1>
          
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <h2 className="text-2xl font-semibold text-white mb-2">Track Not Found</h2>
            <p className="text-gray-400 mb-8">
              The page you&apos;re looking for seems to have skipped to the next track.
            </p>
            
            <div className="flex flex-col md:flex-row gap-3 justify-center">
              <Button
                onClick={() => router.back()}
                variant="outline"
                className="border-white/20 hover:bg-white/10"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go Back
              </Button>
              
              <Link href="/">
                <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                  <Home className="mr-2 h-4 w-4" />
                  Return Home <span className="ml-1 opacity-70">({countdown})</span>
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
        
        <motion.div 
          className="mt-12 text-center text-sm text-gray-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
        >
        </motion.div>
      </div>
    </div>
  );
}