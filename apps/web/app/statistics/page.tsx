import type { Metadata } from "next";

import { MomentsStatistics } from "@/components/moments/statistics";

export const metadata: Metadata = { title: "统计信息" };

export default function StatisticsPage() {
  return <MomentsStatistics />;
}
