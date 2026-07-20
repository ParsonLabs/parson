export type DiscoveryManifest = {
  protocol: string;
  protocolVersion: number;
  instanceId: string;
  name: string;
  product: string;
  serverVersion: string;
};

export type ServerIdentity = {
  instanceId: string | null;
  origin: string | null;
};

const MAX_MANIFEST_BYTES = 64 * 1024;

export function parseDiscoveryManifest(value: unknown): DiscoveryManifest {
  if (!value || typeof value !== "object")
    throw new Error("This is not a compatible Parson library.");
  const manifest = value as Partial<DiscoveryManifest>;
  if (
    manifest.protocol !== "parson" ||
    manifest.protocolVersion !== 1 ||
    manifest.product !== "parson-music" ||
    typeof manifest.instanceId !== "string" ||
    !manifest.instanceId.trim() ||
    typeof manifest.name !== "string" ||
    typeof manifest.serverVersion !== "string"
  ) {
    throw new Error("This is not a compatible Parson library.");
  }
  return manifest as DiscoveryManifest;
}

export async function parseDiscoveryManifestResponse(response: Response) {
  if (!response.ok)
    throw new Error(`Library returned HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES)
    throw new Error("The library manifest is unexpectedly large.");
  const body = await response.text();
  if (new TextEncoder().encode(body).length > MAX_MANIFEST_BYTES)
    throw new Error("The library manifest is unexpectedly large.");
  try {
    return parseDiscoveryManifest(JSON.parse(body) as unknown);
  } catch (cause) {
    if (cause instanceof SyntaxError)
      throw new Error("The library returned an invalid manifest.");
    throw cause;
  }
}

export function serverIdentityChanged(
  current: ServerIdentity,
  next: ServerIdentity,
) {
  return Boolean(
    current.origin &&
    (current.origin !== next.origin || current.instanceId !== next.instanceId),
  );
}
