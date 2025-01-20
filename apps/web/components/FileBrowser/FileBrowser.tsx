"use client"

import { indexLibrary, listDirectory } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import { ScrollArea } from "@music/ui/components/scroll-area";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

interface Directory {
  name: string;
  path: string;
}

export default function FileBrowser() {

  const [currentDirectory, setCurrentDirectory] = useState("/")
  const [currentDirectoryList, setCurrentDirectoryList] = useState<Directory[]>([])

  async function updateList(directoryPath: string) {
    const directoryList = await listDirectory(directoryPath)
    setCurrentDirectory(directoryPath)
    setCurrentDirectoryList(directoryList)
  }

  function getParentDirectory(currentDirectory: string): string {
    const separator = currentDirectory.includes("\\") ? "\\" : "/";
    const parentDirectory = currentDirectory.split(separator).slice(0, -1).join(separator) || separator;
    return parentDirectory
  }

  function goBack() {
    const parentDirectory = getParentDirectory(currentDirectory)
    updateList(parentDirectory);
  }

  useEffect(() => {
    updateList("/")
  }, [])

  return (
    <div className="flex flex-col items-center justify-center py-4" style={{ userSelect: 'none' }}>
      <div className="w-1/2 bg-gray-800 p-4 rounded-md">
        <p className="text-white text-center mb-4">Current Directory: {currentDirectory}</p>
        <div className="flex flex-col items-stretch border h-80 bg-gray-700 p-4 rounded-md">
          <div className="flex justify-between items-center p-2 mb-2 bg-gray-600 rounded-md cursor-pointer hover:bg-gray-500" onClick={goBack} title={getParentDirectory(currentDirectory)}>
            <p className="text-white">...</p>
            <ArrowRight className="text-white" />
          </div>
  
          <ScrollArea>
            {currentDirectoryList.map(directory => (
              <div key={directory.path} className="flex justify-between items-center p-2 mb-2 bg-gray-600 rounded-md cursor-pointer hover:bg-gray-500" title={directory.path} onClick={() => updateList(directory.path)}>
                <p className="text-white">{directory.name}</p>
                <ArrowRight className="text-white" />
              </div>
            ))}
          </ScrollArea>
        </div>
  
        <Button className="w-full px-4 py-2 mt-6 text-white bg-indigo-800 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" onClick={() => indexLibrary(currentDirectory)}>Index Library</Button>
      </div>
    </div>
  )
}