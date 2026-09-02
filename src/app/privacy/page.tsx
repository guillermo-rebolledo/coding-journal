import type { Metadata } from "next";

import { TrustPage } from "@/components/trust/trust-page";
import { privacyDocument } from "@/content/trust";

export const metadata: Metadata = {
  title: privacyDocument.title,
  description: privacyDocument.description,
};

export default function Page() {
  return <TrustPage document={privacyDocument} />;
}
