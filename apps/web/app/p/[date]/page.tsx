import type { Metadata } from "next"

import { MomentDateDetail } from "@/components/moments/date-detail"
import { formatDateHeading } from "@/components/moments/date"

interface DatePageProps {
  params: Promise<{ date: string }>
}

export async function generateMetadata({ params }: DatePageProps): Promise<Metadata> {
  const { date } = await params
  return { title: formatDateHeading(date).split(" 星期")[0] }
}

export default async function DatePage({ params }: DatePageProps) {
  const { date } = await params
  return <MomentDateDetail key={date} date={date} />
}
