"use client"

import { useState } from "react";
import { 
  Dialog,
  DialogContent, 
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose
} from "@music/ui/components/dialog";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type DescriptionProps = { description: string; title?: string };

export default function Description({ description, title = "Description" }: DescriptionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  if (!description) return null;
  
  const truncated = description.length > 180;

  return (
    <div>
      <p className="text-gray-200 leading-relaxed" style={{
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {description}
      </p>

      {truncated && (
        <button 
          onClick={() => setIsModalOpen(true)} 
          className="mt-2 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-full text-xs font-medium transition-colors duration-200"
        >
          READ MORE
        </button>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="bg-zinc-900/95 backdrop-blur-xl border-zinc-800 text-white max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <div className="flex justify-between items-center">
              <DialogTitle className="text-xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                {title}
              </DialogTitle>
            </div>
            <div className="w-full h-px bg-gradient-to-r from-purple-500/20 via-white/10 to-blue-500/20 my-2"></div>
          </DialogHeader>
          
          <div className="overflow-y-auto pr-2 max-h-[60vh]">
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <p className="text-gray-200 leading-relaxed whitespace-pre-line">
                  {description}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}