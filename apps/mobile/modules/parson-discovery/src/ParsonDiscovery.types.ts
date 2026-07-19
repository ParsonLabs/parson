export type ParsonDiscoveryModuleEvents = {
  onService: (params: DiscoveredService) => void;
};

export type DiscoveredService = {
  name: string;
  host: string;
  port: number;
};
