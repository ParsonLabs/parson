"use client"

import { useEffect } from "react";
import { useGradientHover } from "../Providers/GradientHoverProvider";
import { FastAverageColor } from "fast-average-color";
import getBaseURL from "@/lib/Server/getBaseURL";

export default function PageGradient({ imageSrc }: { imageSrc: string }) {
  const { setGradient } = useGradientHover()

  useEffect(() => {
    const fac = new FastAverageColor();
    const getColor = async () => {
      const processedImageSrc = !imageSrc.startsWith("http://") && !imageSrc.startsWith("https://")
              ? `${getBaseURL()}/image/${encodeURIComponent(imageSrc)}?raw=true`
              : imageSrc;

              
      try {
        const color = await fac.getColorAsync(processedImageSrc)
        setGradient(color.hex)
      } catch (error) {
        console.error('Error getting color:', error)
        setGradient('#000000')
      }
    }

    getColor()
  }, [imageSrc, setGradient])

  return <></>
}