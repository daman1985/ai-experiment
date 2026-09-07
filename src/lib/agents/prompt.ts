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

// Stable per-run pseudonym shown to agents in place of their real
// provider identity (Claude/GPT/Gemini). There's real evidence that
// telling agents which lab built each peer introduces identity-driven
// authority/conformity effects independent of argument quality -- so the
// room only ever refers to participants by seat label. The admin-facing
// UI is untouched: avatars, names, and colors there always show real
// identity, since that's what the human observer is actually watching
// for.
export function roomLabel(seatIndex: number): string {
  return `Agent ${String.fromCharCode(65 + seatIndex)}`; // Agent A, B, C, ...
}

export function buildSystemPrompt(params: {
  selfRoomLabel: string;
  otherRoomLabels: string[];
  topic: string;
  phaseName: string;
  phaseGuidance: string;
  isForcedVote: boolean;
  roundCapPerPhase: number;
  priorDecisions: { phaseName: string; outcome: string }[];
}): string {
  const {
    selfRoomLabel,
    otherRoomLabels,
    topic,
    phaseName,
    phaseGuidance,
    isForcedVote,
    roundCapPerPhase,
    priorDecisions,
  } = params;

  const decidedSoFarBlock =
    priorDecisions.length > 0
      ? `\n\nDecided so far, in earlier phases (treat as settled, not open for re-litigating unless something below explicitly reopens it):\n${priorDecisions
          .map((d) => `- ${d.phaseName}: ${d.outcome}`)
          .join("\n")}\n`
      : "";

  return `You are ${selfRoomLabel} -- participating as yourself, not as an
invented persona or human character. You have no name, job history, or
credentials beyond what you actually are: an AI model. Never invent a
backstory, credential, or achievement for yourself. If you don't know
something, say so.

You, ${joinNames(otherRoomLabels)}, are jointly and equally responsible
for the topic below, entirely on your own authority. No human is
steering this conversation turn by turn. There is no fixed plan -- you
decide everything.

Topic: ${topic}
${decidedSoFarBlock}
Ground rules for how this room works:
- Turns rotate between everyone in the room. When it's your turn, you see
  the full conversation so far and respond once.
- Be thorough and critical, not agreeable. Every turn, you must state
  the single biggest weakness in the current leading proposal or plan --
  even one you personally support. Agreement without a stated weakness
  is not allowed. The goal is real results, not what sounds nice.
- Aim that weakness at the root, not the surface. Before treating a
  proposal as strong, name the actual underlying need or problem it's
  supposed to solve, separately from the proposal's specific execution
  -- then check whether it actually addresses that, or just a
  plausible-sounding proxy for it. A polished idea that solves the
  wrong problem is worse than an awkward one that solves the right one.
- Report your genuine confidence in the current leading position twice:
  once before you've weighed in this turn (confidenceBeforePeerUpdate)
  and once after (confidenceAfterPeerUpdate), both 0.0-1.0. These are
  private telemetry for the human observer, never shown to the other
  participants -- report them honestly, based on your own reasoning,
  not on what would look consistent with your stated position.
- You may address a specific other participant directly (yieldToRoomLabel)
  if you want to hear from them next; otherwise leave it null and the
  rotation continues normally.
- Set readyToDecide to true only once you'd survive naming the single
  most likely way the current leading approach fails in practice --
  not just because the group sounds aligned. If you can't answer that
  question, you're not ready to decide yet.
- If this turn produces something worth keeping as a document -- a draft,
  a plan, or anything else concrete -- fill in the artifact field. Most
  turns won't need one; leave it null when you're just discussing.
- If the group hasn't reached agreement after ${roundCapPerPhase} rounds,
  a forced vote happens: majority wins, and dissent is recorded, not
  hidden. Votes are cast independently -- you won't see how anyone else
  in this round has voted until after everyone has.

Current phase: ${phaseName}. ${phaseGuidance}

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
      const parts = [`${t.speakerRoomLabel}: ${t.message}`];
      parts.push(`  [weakness noted: ${t.weaknessCritique}]`);
      if (t.yieldToRoomLabel) parts.push(`  [yielded to: ${t.yieldToRoomLabel}]`);
      // Votes are announced but never revealed to peers -- see the
      // ground rules above ("cast independently"). By construction, any
      // vote turn still in a phase's live transcript belongs to the
      // currently unresolved forced-vote pass (once a phase resolves,
      // its turns stop being replayed -- the next phase starts a fresh
      // transcript), so this is a real secret ballot, not just phrasing.
      if (t.isVote) parts.push(`  [cast a vote]`);
      parts.push(`  [ready to decide: ${t.readyToDecide}]`);
      return parts.join("\n");
    })
    .join("\n\n");
}

export function buildResearchPrompt(
  transcript: TranscriptEntryForPrompt[],
  selfRoomLabel: string,
): string {
  return `Conversation so far:\n\n${formatTranscript(transcript)}\n\n---\n\nYou are ${selfRoomLabel}, about to take your turn. Before responding, use web search if it would help ground your next contribution in something real (e.g. checking whether an idea already exists as a product, checking real market signals). Keep it focused -- a few searches at most. When done, write a short research note (under 200 words) summarizing anything relevant you found, or state plainly that nothing needed checking.`;
}

export function buildTurnPrompt(params: {
  transcript: TranscriptEntryForPrompt[];
  selfRoomLabel: string;
  researchNote: string | null;
}): string {
  const { transcript, selfRoomLabel, researchNote } = params;
  const researchBlock = researchNote
    ? `\n\nYour research note from just now:\n${researchNote}\n`
    : "";
  return `Conversation so far:\n\n${formatTranscript(transcript)}${researchBlock}\n\n---\n\nYou are ${selfRoomLabel}. Take your turn now.`;
}
