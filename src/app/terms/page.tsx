import type { Metadata } from "next";

import { TrustPage } from "@/components/trust/trust-page";
import { termsDocument } from "@/content/trust";

export const metadata: Metadata = {
  title: termsDocument.title,
  description: termsDocument.description,
};

export default function Page() {
  return <TrustPage document={termsDocument} />;
}
