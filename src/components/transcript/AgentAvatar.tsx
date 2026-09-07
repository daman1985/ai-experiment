import type { Provider } from "@prisma/client";
import { AGENT_STYLES, agentInitials } from "@/lib/agents/agentColor";

export function AgentAvatar({
  provider,
  displayName,
  size = "md",
}: {
  provider: Provider;
  displayName: string;
  size?: "sm" | "md";
}) {
  const styles = AGENT_STYLES[provider];
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <span
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full font-semibold ${styles.avatarBg} ${styles.avatarText}`}
      aria-hidden="true"
    >
      {agentInitials(displayName)}
    </span>
  );
}
