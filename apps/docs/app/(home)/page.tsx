import img1 from "@/public/1.png";
import img2 from "@/public/2.png";
import img3 from "@/public/3.png";
import img4 from "@/public/4.png";
import img5 from "@/public/5.png";
import img6 from "@/public/6.png";
import img7 from "@/public/7.png";
import img8 from "@/public/8.png";

import Image from 'next/image';
import Link from "next/link";

export const revalidate = 3600

const images = [img1, img2, img3, img4, img5, img6, img7, img8];
const randomImage = images[Math.floor(Math.random() * images.length)];

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center text-center overflow-hidden">
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden">
        <Image
          src={randomImage}
          alt="Random Image"
          layout="fill"
          objectFit="cover"
          className="absolute top-0 left-0 w-full h-full blur-xl filter brightness-125"
        />
      </div>
      <div className="z-10 flex flex-col items-center fixed ">
        <h1 className="mb-4 text-4xl font-bold text-white">ParsonLabs Music Documentation</h1>
        <p className="text-lg text-gray-300 mt-4 max-w-2xl">
          ParsonLabs Music is the Self Hosted Audio streaming alternative to YouTube Music, Spotify & Apple Music, providing Unrestricted Access to your library in Uncompressed, Lossless Quality.
        </p>
        <div className="flex flex-row gap-5 mt-4">
          <img src="https://www.pwa-shields.com/1.0.0/series/certified/purple.svg" alt="PWA Shields" height="20" />
          <img src="https://img.shields.io/github/stars/WillKirkmanM/music" height={20} />
        </div>
        <div className="flex space-x-4 mt-8">
          <Link href="/docs">
            <button className="px-4 py-2 bg-gradient-to-r from-gray-600 to-gray-800 text-white font-semibold rounded-lg shadow-md hover:from-gray-500 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-75">
              Get Started
            </button>
          </Link>
          <Link href="https://github.com/WillKirkmanM/music/releases" target="_blank" rel="noopener noreferrer">
            <button className="px-4 py-2 bg-gradient-to-r from-gray-200 to-gray-400 text-black font-semibold rounded-lg shadow-md hover:from-gray-300 hover:to-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-75">
              Downloads
            </button>
          </Link>
        </div>
      </div>
    </main>
  );
}