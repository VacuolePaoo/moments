import type { Metadata } from "next";

import { MomentsSettings } from "@/components/moments/settings";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  return <MomentsSettings />;
}
