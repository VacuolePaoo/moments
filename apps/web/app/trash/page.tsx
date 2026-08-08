import type { Metadata } from "next";

import { MomentsTrash } from "@/components/moments/trash";

export const metadata: Metadata = { title: "回收站" };

export default function TrashPage() {
  return <MomentsTrash />;
}
