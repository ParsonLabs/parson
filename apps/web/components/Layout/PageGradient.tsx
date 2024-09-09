"use client"

import { useEffect } from "react";
import { useGradientHover } from "../Providers/GradientHoverProvider";
import { FastAverageColor } from "fast-average-color";

export default function PageGradient({ imageSrc }: { imageSrc: string }) {
  const { setGradient } = useGradientHover()

  useEffect(() => {
    const fac = new FastAverageColor();
    const getColor = async () => {
      const color = await fac.getColorAsync(imageSrc)
      setGradient(color.hex)
    }

    getColor()
  }, [imageSrc, setGradient])

  return <></>
}