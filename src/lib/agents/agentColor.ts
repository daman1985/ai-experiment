import type { Provider } from "@prisma/client";

// The three-opacity-tier mechanism from docs/design-system.md: full
// opacity for the name label, a 6% wash for the row background, 20% for
// the row's left rule. Written as literal class strings (not built from
// a template) so Tailwind's static scanner can see them.
interface AgentStyle {
  text: string;
  rowBg: string;
  rowBorder: string;
  avatarBg: string;
  avatarText: string;
  ruleBorder: string;
  dot: string;
}

export const AGENT_STYLES: Record<Provider, AgentStyle> = {
  ANTHROPIC: {
    text: "text-agent-claude",
    rowBg: "bg-agent-claude/6",
    rowBorder: "border-agent-claude/20",
    avatarBg: "bg-agent-claude/15",
    avatarText: "text-agent-claude",
    ruleBorder: "border-agent-claude/30",
    dot: "bg-agent-claude",
  },
  OPENAI: {
    text: "text-agent-gpt",
    rowBg: "bg-agent-gpt/6",
    rowBorder: "border-agent-gpt/20",
    avatarBg: "bg-agent-gpt/15",
    avatarText: "text-agent-gpt",
    ruleBorder: "border-agent-gpt/30",
    dot: "bg-agent-gpt",
  },
  GOOGLE: {
    text: "text-agent-gemini",
    rowBg: "bg-agent-gemini/6",
    rowBorder: "border-agent-gemini/20",
    avatarBg: "bg-agent-gemini/15",
    avatarText: "text-agent-gemini",
    ruleBorder: "border-agent-gemini/30",
    dot: "bg-agent-gemini",
  },
};

export function agentInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return displayName.slice(0, 2).toUpperCase();
}
