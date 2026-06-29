import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { OaClient } from "../../client.ts";
import { type ApprovalRequest, asApprovalRequest } from "../../approvals.ts";
import { eventText } from "../../chat-text.ts";
import { COLORS, Frame, Hint } from "../theme.tsx";

interface Props {
  client: OaClient;
  onBack: () => void;
  onError: (err: unknown) => void;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** Interactive chat. A session is created lazily on the first send; each turn
 * streams text_delta tokens (thinking_delta omitted by eventText) into a live
 * transcript held in state.
 *
 * When the model calls a MUTATING tool the server pauses and emits an
 * `approval_required` frame. Because chatStream awaits onEvent, we can render an
 * inline Approve/Deny card and hold the stream until the user chooses — then POST
 * the decision (the same gate `oa do` and the web UI use) and let it resume. */
export const Chat: React.FC<Props> = ({ client, onBack, onError }) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ApprovalRequest | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  // Resolver for the in-flight approval promise the stream loop is awaiting.
  const decideRef = useRef<((approved: boolean) => void) | undefined>(undefined);

  // While an approval is pending, y/n decide it (and swallow other keys). esc
  // backs out otherwise (works even while the TextInput is focused — it ignores esc).
  useInput((char, key) => {
    const decide = decideRef.current;
    if (decide) {
      const ch = char.toLowerCase();
      if (ch === "y" || ch === "n") {
        decideRef.current = undefined;
        decide(ch === "y");
      }
      return;
    }
    if (key.escape && !busy) onBack();
  });

  async function send(): Promise<void> {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setTurns((t) => [...t, { role: "user", text: message }, { role: "assistant", text: "" }]);
    try {
      const sessionId = sessionRef.current ?? (await client.createSession()).id;
      sessionRef.current = sessionId;
      await client.chatStream({ sessionId, message }, async (event) => {
        // Mutating-tool gate: surface a card and pause the stream until the user
        // chooses, then POST the decision so the awaited onEvent resolves.
        const approval = asApprovalRequest(event);
        if (approval) {
          const approved = await new Promise<boolean>((resolve) => {
            decideRef.current = resolve;
            setPending(approval);
          });
          decideRef.current = undefined;
          setPending(undefined);
          await client.approveChatToolCall(approval.requestId, approved);
          setTurns((t) => {
            const copy = t.slice();
            const last = copy[copy.length - 1];
            const note = `[${approved ? "approved" : "denied"} ${approval.toolName}] `;
            copy[copy.length - 1] = { ...last, text: last.text + note };
            return copy;
          });
          return;
        }
        const tok = eventText(event);
        if (!tok) return;
        setTurns((t) => {
          const copy = t.slice();
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, text: last.text + tok };
          return copy;
        });
      });
    } catch (err) {
      onError(err);
    } finally {
      decideRef.current = undefined;
      setPending(undefined);
      setBusy(false);
    }
  }

  return (
    <Frame title="Chat">
      <Box flexDirection="column">
        {turns.length === 0 ? <Hint>Type a message and press Enter. esc to go back.</Hint> : null}
        {turns.map((turn, i) => (
          <Box key={i} marginBottom={turn.role === "assistant" ? 1 : 0}>
            <Text color={turn.role === "user" ? COLORS.signal : COLORS.faint}>
              {turn.role === "user" ? "you  " : "oa   "}
            </Text>
            <Text color={turn.role === "user" ? COLORS.ink : COLORS.accent}>{turn.text}</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          {pending ? (
            <ApprovalCard approval={pending} />
          ) : busy ? (
            <Text color={COLORS.muted}>
              <Spinner type="dots" /> thinking…
            </Text>
          ) : (
            <Box>
              <Text color={COLORS.accent}>{"❯ "}</Text>
              <TextInput value={input} onChange={setInput} onSubmit={() => void send()} />
            </Box>
          )}
        </Box>
      </Box>
    </Frame>
  );
};

/** Inline HITL card for a mutating tool call — tool, server, args, preview, and
 * the y/n choice. Rendered while the stream is paused on the approval gate. */
const ApprovalCard: React.FC<{ approval: ApprovalRequest }> = ({ approval }) => (
  <Box flexDirection="column">
    <Text color={COLORS.warn}>
      Approval required: {approval.toolName}
      {approval.serverName ? ` (${approval.serverName})` : ""}
    </Text>
    {approval.preview ? <Text color={COLORS.muted}>{approval.preview}</Text> : null}
    {approval.args !== undefined ? (
      <Text color={COLORS.faint}>args: {JSON.stringify(approval.args)}</Text>
    ) : null}
    <Text color={COLORS.accent}>[y] approve   [n] deny</Text>
  </Box>
);
