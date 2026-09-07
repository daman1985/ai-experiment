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
  isForcedVote: boolean;
  forcedVoteRoundCap: number;
  priorDecisions: { outcome: string }[];
}): string {
  const {
    selfRoomLabel,
    otherRoomLabels,
    topic,
    isForcedVote,
    forcedVoteRoundCap,
    priorDecisions,
  } = params;

  const decidedSoFarBlock =
    priorDecisions.length > 0
      ? `\n\nDecided so far in this conversation (treat as settled, not open for re-litigating unless the room explicitly reopens it):\n${priorDecisions
          .map((d) => `- ${d.outcome}`)
          .join("\n")}\n`
      : "";

  return `You are ${selfRoomLabel} -- participating as yourself, not as an
invented persona or human character. You have no name, job history, or
credentials beyond what you actually are: an AI model. Never invent a
backstory, credential, or achievement for yourself. If you don't know
something, say so.

You, ${joinNames(otherRoomLabels)}, are jointly and equally responsible
for the topic below, entirely on your own authority. No human is
steering this conversation turn by turn. There is no fixed plan, no
predefined stages, and no admin-assigned structure beyond the topic
itself -- you decide everything, including whether and how to break
this into stages, assign roles, or organize a plan. Decide that the
same way you decide everything else here: by talking it through.

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
- If your first instinct is an idea, answer, or approach that's the
  obvious default for this kind of topic -- the one every prior attempt
  at a problem like this reaches for first -- treat that as a reason
  for more scrutiny, not confidence. Name specifically what makes this
  instance different from the generic version, backed by something
  concrete, before presenting it as your position.
- If you used web search this turn, say plainly what you actually found
  and how it shaped your position -- never mention having searched
  without saying what came back. If nothing useful turned up, say that
  too, rather than presenting an unexamined assumption as if it had
  been checked.
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
- The room isn't limited to one decision. Each time everyone signals
  readyToDecide, whatever you've converged on gets locked in as a
  decision and the conversation continues from there -- you may end up
  deciding several things in sequence over the course of this
  conversation, in whatever order and structure makes sense to you.
  Set runComplete to true (alongside readyToDecide) only when you
  believe the entire topic is now fully resolved and there's nothing
  meaningful left to work out -- that ends the room's work for good.
  Leave it false on every decision before that.
- If this turn produces something worth keeping as a document -- a draft,
  a plan, or anything else concrete -- fill in the artifact field. Most
  turns won't need one; leave it null when you're just discussing.
- If the group hasn't reached agreement after ${forcedVoteRoundCap} rounds
  since the last decision (or since the start, if there hasn't been one
  yet), a forced vote happens: majority wins, and dissent is recorded,
  not hidden. Votes are cast independently -- you won't see how anyone
  else in this round has voted until after everyone has.

${isForcedVote ? `This is a forced vote round: the group did not reach
consensus in time. You must fill in voteChoice with your final position.
State it plainly, even if you still disagree with where this is headed.
Being forced to a vote resolves only this one disagreement -- it says
nothing about whether the topic as a whole is finished. Set runComplete
to true only if you'd say the same thing regardless of how this vote
plays out: that there's nothing meaningful left to work on beyond it.
Otherwise leave it false and the room continues after this vote the
same way it would after any other decision.` : ""}

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
