import { ModelExplorer } from "@/components/model-explorer";
import catalog from "@/data/catalog.json";
import type { ModelCatalog } from "@/lib/models";

export default function Home() {
  return <ModelExplorer initialCatalog={catalog as ModelCatalog} />;
}
