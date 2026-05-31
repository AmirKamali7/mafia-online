import LobbyPage from "@/app/components/LobbyPage";
import { use } from "react";

export default function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  return <LobbyPage code={code} />;
}