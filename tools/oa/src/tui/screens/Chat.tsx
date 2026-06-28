import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { OaClient } from "../../client.ts";
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
 * transcript held in state. */
export const Chat: React.FC<Props> = ({ client, onBack, onError }) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<string | undefined>(undefined);

  // esc backs out (works even while the TextInput is focused — it ignores esc).
  useInput((_input, key) => {
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
      await client.chatStream({ sessionId, message }, (event) => {
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
          {busy ? (
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
