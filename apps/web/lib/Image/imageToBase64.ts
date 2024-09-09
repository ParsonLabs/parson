"use server"

import fs from "fs"

export default async function imageToBase64(src: string) {
  if (!src || src.length === 0) return ""

  const image = fs.readFileSync(src);
  const base64Image = Buffer.from(image).toString("base64");
  return base64Image;
}