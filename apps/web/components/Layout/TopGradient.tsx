"use client"

import { useGradientHover } from "../Providers/GradientHoverProvider"
import { motion, AnimatePresence } from "framer-motion"

export default function TopBlur() {
  const { 
    gradient, 
    previousGradient, 
    isTransitioning,
    transitionDuration 
  } = useGradientHover();
  
  return (
    <>
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            key="previous-gradient"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: transitionDuration / 1000, ease: "easeOut" }}
            className="absolute top-0 left-0 w-full h-48 bg-gradient-to-b to-transparent z-0"
            style={{ 
              backgroundImage: `linear-gradient(${previousGradient}30, transparent)`,
              pointerEvents: "none"
            }}
          />
        )}
      </AnimatePresence>

      <motion.div
        key="current-gradient"
        initial={isTransitioning ? { opacity: 0 } : { opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ duration: transitionDuration / 1000, ease: "easeIn" }}
        className="absolute top-0 left-0 w-full h-48 bg-gradient-to-b to-transparent z-0"
        style={{ 
          backgroundImage: `linear-gradient(${gradient}30, transparent)`,
          pointerEvents: "none"
        }}
      />
    </>
  )
}