import type { Metadata } from "next";

import { TrustPage } from "@/components/trust/trust-page";
import { dataAccessDocument } from "@/content/trust";

export const metadata: Metadata = {
  title: dataAccessDocument.title,
  description: dataAccessDocument.description,
};

export default function Page() {
  return <TrustPage document={dataAccessDocument} />;
}
