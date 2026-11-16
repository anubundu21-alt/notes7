import { createFileRoute } from "@tanstack/react-router";
import { QuireApp } from "@/components/notes/quire-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <QuireApp />;
}
