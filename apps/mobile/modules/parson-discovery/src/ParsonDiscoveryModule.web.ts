import { registerWebModule, NativeModule } from "expo";

import { ParsonDiscoveryModuleEvents } from "./ParsonDiscovery.types";

class ParsonDiscoveryModule extends NativeModule<ParsonDiscoveryModuleEvents> {
  start() {}
  stop() {}
}

export default registerWebModule(
  ParsonDiscoveryModule,
  "ParsonDiscoveryModule",
);
