import { invalidateCache } from "@/lib/Caching/cache";
import { Button } from "@music/ui/components/button";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@music/ui/components/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@music/ui/components/tabs";
import ChangeBitrate from "./ChangeBitrate";
import { ChangePassword } from "./ChangePassword";
import Username from "./Username";

export default function SettingsDialog() {

  return (
    <DialogContent className="text-black overflow-x-auto">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Make yourself at home. Change your username, password, or even the
          audio quality.
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="audio">Audio</TabsTrigger>
          <TabsTrigger value="cache">Cache</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <Username />
          <ChangePassword />
        </TabsContent>

        <TabsContent value="audio">
          <ChangeBitrate />
        </TabsContent>

        <TabsContent value="cache">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3 md:col-span-1 mb-4">
              <form onSubmit={() => {}}>
                <Button type="submit">Everything</Button>
              </form>
            </div>

            <div className="col-span-3 md:col-span-1 mb-4">
              <form onSubmit={() => invalidateCache("landingCarousel")}>
                <Button type="submit">Landing Album</Button>
              </form>
            </div>

            <div className="col-span-3 md:col-span-1 mb-4">
              <form onSubmit={() => invalidateCache("fromYourLibrary")}>
                <Button type="submit">From Your Library</Button>
              </form>
            </div>

            <div className="col-span-3 md:col-span-1 mb-4">
              <form onSubmit={() => invalidateCache("randomSongs")}>
                <Button type="submit">Random Songs</Button>
              </form>
            </div>

            <div className="col-span-3 md:col-span-1 mb-4">
              <form onSubmit={() => invalidateCache("recommendedAlbums")}>
                <Button type="submit">Recommended Albums</Button>
              </form>
            </div>
          </div>
          </TabsContent>
      </Tabs>
    </DialogContent>
  );
}
