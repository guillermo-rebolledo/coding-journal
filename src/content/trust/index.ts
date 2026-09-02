import { dataAccessDocument } from "@/content/trust/data-access";
import { privacyDocument } from "@/content/trust/privacy";
import { termsDocument } from "@/content/trust/terms";
import type { TrustDocument } from "@/content/trust/types";

/** Navigation order across the three trust pages, shared by the shell. */
export const trustDocuments: readonly TrustDocument[] = [
  privacyDocument,
  termsDocument,
  dataAccessDocument,
];

export { dataAccessDocument, privacyDocument, termsDocument };
export type { TrustDocument } from "@/content/trust/types";
