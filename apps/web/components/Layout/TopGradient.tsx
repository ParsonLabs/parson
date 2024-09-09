"use client"

import { useGradientHover } from "../Providers/GradientHoverProvider"

export default function TopBlur() {
  const { gradient } = useGradientHover()

  return (
    <div 
      className="absolute top-0 left-0 w-full h-48 bg-gradient-to-b to-transparent z-0 transition-opacity"
      style={{ backgroundImage: `linear-gradient(${gradient}, transparent)` }}
    />
  )
}