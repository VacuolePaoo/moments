import type { Metadata } from "next";

import { MomentDateDetail } from "@/components/moments/date-detail";
import { formatDateTitle } from "@/components/moments/date";

interface DatePageProps {
  params: Promise<{ date: string }>;
}

export async function generateMetadata({
  params,
}: DatePageProps): Promise<Metadata> {
  const { date } = await params;
  return { title: formatDateTitle(date) };
}

export default async function DatePage({ params }: DatePageProps) {
  const { date } = await params;
  return <MomentDateDetail key={date} date={date} />;
}
