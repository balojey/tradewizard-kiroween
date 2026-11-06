import { Magic } from "magic-sdk";
import { polygon } from "viem/chains";
import { getPolygonRpcUrl } from "@/constants/polymarket";

let magicInstance: Magic | null = null;

export default function getMagic(): Magic {
  if (!magicInstance && typeof window !== "undefined") {
    magicInstance = new Magic(process.env.NEXT_PUBLIC_MAGIC_API_KEY!, {
      network: { rpcUrl: getPolygonRpcUrl(), chainId: polygon.id },
    });
  }
  return magicInstance!;
}
