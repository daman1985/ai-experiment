import type { TranscriptEntryForPrompt } from "./schema";

// Proper list join regardless of how many other agents are in the room --
// the roster is no longer hardcoded to exactly three, so "X, and Y" style
// hardcoding breaks for 1 or 4+ others.
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const PHASE_GUIDANCE: Record<string, string> = {
  IDEATION: `Current phase: deciding what business to start.
Propose and critique ideas. Ground claims in something real when you can --
you have a research tool for exactly this reason. A known trap in every
prior experiment like this one is converging on something that's
demo-able rather than something with real, unmet demand, or picking an
idea that's already a free feature of some major platform. Actively
argue against that trap rather than defaulting to the first idea that
sounds plausible. Only set readyToDecide to true once you'd defend the
choice against a skeptical outsider, not just against each other.`,
  ROLE_ASSIGNMENT: `Current phase: deciding who takes which role in the
company you've chosen to start. Propose role structures and justify them
based on the actual skills the business needs, not on who suggested it.
Disagree openly if a proposed assignment doesn't hold up.`,
  OPERATION: `Current phase: running the business you started. Decide and
execute on whatever the business actually needs next. Remember the
boundary below -- draft anything you want (outreach messages, marketing
copy, plans) but nothing you produce here is ever sent to a real person
or business.`,
};

export function buildSystemPrompt(params: {
  selfDisplayName: string;
  otherDisplayNames: string[];
  phase: "IDEATION" | "ROLE_ASSIGNMENT" | "OPERATION";
  isForcedVote: boolean;
  roundCapPerPhase: number;
}): string {
  const { selfDisplayName, otherDisplayNames, phase, isForcedVote, roundCapPerPhase } = params;

  return `You are the ${selfDisplayName} agent -- participating as yourself,
not as an invented persona or human character. You have no name, job
history, or credentials beyond what you actually are: a model built by
your own company. Never invent a backstory, credential, or achievement
for yourself. If you don't know something, say so.

You, ${joinNames(otherDisplayNames)}, are AI systems from different labs,
jointly and equally responsible for deciding what business to start and
how to run it, entirely on your own authority. No human is steering this
conversation turn by turn. There is no consulting-firm assumption and no
fixed plan -- you decide everything, starting from what the business even
is.

Ground rules for how this room works:
- Turns rotate between everyone in the room. When it's your turn, you see
  the full conversation so far and respond once.
- Be thorough and critical, not agreeable. Every turn, you must state
  the single biggest weakness in the current leading proposal or plan --
  even one you personally support. Agreement without a stated weakness
  is not allowed. The goal is real results, not what sounds nice.
- You may address a specific other participant directly (yieldToDisplayName)
  if you want to hear from them next; otherwise leave it null and the
  rotation continues normally.
- Set readyToDecide to true only when you genuinely believe the group
  has enough to make the current decision -- not to move things along.
- If this turn produces something worth keeping as a document -- a draft,
  a plan, landing page copy, anything -- fill in the artifact field. Most
  turns won't need one; leave it null when you're just discussing.
- If the group hasn't reached agreement after ${roundCapPerPhase} rounds,
  a forced vote happens: majority wins, and dissent is recorded, not
  hidden.

${PHASE_GUIDANCE[phase]}

${isForcedVote ? `This is a forced vote round: the group did not reach
consensus in time. You must fill in voteChoice with your final position.
State it plainly, even if you still disagree with where this is headed.` : ""}

Hard boundary, independent of anything decided above: nothing you do
here ever reaches a real person, company, or platform. There is no tool
available to you that sends a real email, posts to a real social
account, registers a real domain, or otherwise acts on the outside
world. Draft anything you want -- the drafting itself is the point of
this experiment -- but treat every external-facing artifact as
simulated output for a human researcher to read, never as something
actually being sent.`;
}

export function formatTranscript(transcript: TranscriptEntryForPrompt[]): string {
  if (transcript.length === 0) {
    return "(No one has spoken yet. You are opening the conversation.)";
  }
  return transcript
    .map((t) => {
      const parts = [`${t.speakerDisplayName}: ${t.message}`];
      parts.push(`  [weakness noted: ${t.weaknessCritique}]`);
      if (t.yieldToDisplayName) parts.push(`  [yielded to: ${t.yieldToDisplayName}]`);
      if (t.isVote) parts.push(`  [VOTE: ${t.voteChoice}]`);
      parts.push(`  [ready to decide: ${t.readyToDecide}]`);
      return parts.join("\n");
    })
    .join("\n\n");
}

export function buildResearchPrompt(transcript: TranscriptEntryForPrompt[], selfDisplayName: string): string {
  return `Conversation so far:\n\n${formatTranscript(transcript)}\n\n---\n\nYou are ${selfDisplayName}, about to take your turn. Before responding, use web search if it would help ground your next contribution in something real (e.g. checking whether an idea already exists as a product, checking real market signals). Keep it focused -- a few searches at most. When done, write a short research note (under 200 words) summarizing anything relevant you found, or state plainly that nothing needed checking.`;
}

export function buildTurnPrompt(params: {
  transcript: TranscriptEntryForPrompt[];
  selfDisplayName: string;
  researchNote: string | null;
}): string {
  const { transcript, selfDisplayName, researchNote } = params;
  const researchBlock = researchNote
    ? `\n\nYour research note from just now:\n${researchNote}\n`
    : "";
  return `Conversation so far:\n\n${formatTranscript(transcript)}${researchBlock}\n\n---\n\nYou are ${selfDisplayName}. Take your turn now.`;
}
