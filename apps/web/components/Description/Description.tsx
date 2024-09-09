"use client"

import { useState } from "react"

type DescriptionProps = { description: string }

export default function Description({ description }: DescriptionProps) {
  const [showFullDescription, setShowFullDescription] = useState(false)

  return description && 
    <>
      <p style={{
        display: '-webkit-box',
        WebkitLineClamp: showFullDescription ? 'none' : '3',
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
      {description}
      </p>

      <button onClick={() => setShowFullDescription(!showFullDescription)} className="py-2">
        <p className="font-semibold">{showFullDescription ? 'LESS' : 'MORE'}</p>
      </button>
    </>
}