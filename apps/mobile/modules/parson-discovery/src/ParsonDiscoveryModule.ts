import { NativeModule, requireNativeModule } from "expo";

import { ParsonDiscoveryModuleEvents } from "./ParsonDiscovery.types";

declare class ParsonDiscoveryModule extends NativeModule<ParsonDiscoveryModuleEvents> {
  start(): void;
  stop(): void;
}

export default requireNativeModule<ParsonDiscoveryModule>("ParsonDiscovery");
