import GamePage from "@/app/components/GamePage";
import { use } from "react";

export default function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  return <GamePage code={code} />;
}