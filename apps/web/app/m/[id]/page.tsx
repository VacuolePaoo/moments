import type { Metadata } from "next";

import { MomentPostDetail } from "@/components/moments/post-detail";

interface PostPageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "分享给你的moment",
};

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;
  return <MomentPostDetail key={id} id={id} />;
}
