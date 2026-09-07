import type { Agent } from "@prisma/client";
import { AGENT_STYLES } from "@/lib/agents/agentColor";

// The one deliberate personality touch in the shell (see
// docs/design-system.md, "Signature motif") -- linear marks for each
// active agent, current position highlighted. Doubles as the practical
// "whose turn is it" indicator.
export function TurnStepper({
  agents,
  currentAgentId,
}: {
  agents: Agent[];
  currentAgentId: string | null;
}) {
  if (agents.length === 0) return null;
  return (
    <ol className="flex items-center gap-2.5" aria-label="Turn order">
      {agents.map((a) => {
        const isCurrent = a.id === currentAgentId;
        const styles = AGENT_STYLES[a.provider];
        return (
          <li key={a.id} title={a.displayName}>
            <span
              className={`block rounded-full transition-all duration-150 ${
                isCurrent ? `h-2.5 w-2.5 ${styles.dot}` : "h-2 w-2 border border-border"
              }`}
            />
            {isCurrent && <span className="sr-only">Current turn: {a.displayName}</span>}
          </li>
        );
      })}
    </ol>
  );
}
