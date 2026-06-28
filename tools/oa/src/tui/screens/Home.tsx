import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import type { Health, OaClient, WhoAmI } from "../../client.ts";
import { COLORS, Frame } from "../theme.tsx";

/** The destinations the home menu can route to. */
export type Destination = "chat" | "flows" | "agents" | "keys" | "login";

interface Props {
  client: OaClient;
  onNavigate: (to: Destination) => void;
  onQuit: () => void;
}

const QUIT = "__quit";

/** Landing screen: identity + health badge, then the main menu. */
export const Home: React.FC<Props> = ({ client, onNavigate, onQuit }) => {
  const [who, setWho] = useState<WhoAmI | undefined>();
  const [health, setHealth] = useState<Health | undefined>();

  useEffect(() => {
    let alive = true;
    client.whoami().then((w) => alive && setWho(w)).catch(() => {});
    client.health().then((h) => alive && setHealth(h)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  // `q` quits — safe here because Home has no free-text field.
  useInput((input) => {
    if (input === "q") onQuit();
  });

  const healthColor = health?.status === "ok" || health?.status === "healthy" ? COLORS.ok : COLORS.warn;

  return (
    <Frame title="Home">
      <Box marginBottom={1}>
        <Text color={COLORS.muted}>{who ? `${who.email} (${who.isAdmin ? "admin" : "user"})` : "…"}</Text>
        <Text color={COLORS.faint}>{"   ·   health: "}</Text>
        <Text color={healthColor}>{health?.status ?? "…"}</Text>
      </Box>
      <SelectInput
        items={[
          { label: "Chat", value: "chat" },
          { label: "Flows", value: "flows" },
          { label: "Agents", value: "agents" },
          { label: "Keys", value: "keys" },
          { label: "Switch profile", value: "login" },
          { label: "Quit", value: QUIT },
        ]}
        onSelect={(item) => {
          if (item.value === QUIT) onQuit();
          else onNavigate(item.value as Destination);
        }}
        indicatorComponent={({ isSelected }) => (
          <Text color={COLORS.accent}>{isSelected ? "❯ " : "  "}</Text>
        )}
      />
    </Frame>
  );
};
