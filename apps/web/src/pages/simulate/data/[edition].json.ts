import type { EditionBundle } from "@lol/data";
import type { APIRoute } from "astro";
import { archive } from "../../../lib/archive";
import { buildPayload, editionSlug } from "../../../lib/studio-data";

export function getStaticPaths() {
  return archive.editions.map((bundle) => ({
    params: { edition: editionSlug(bundle) },
    props: { bundle },
  }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(buildPayload((props as { bundle: EditionBundle }).bundle)), {
    headers: { "Content-Type": "application/json" },
  });
