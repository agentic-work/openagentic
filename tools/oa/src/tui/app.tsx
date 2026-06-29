import React, { useState } from "react";
import { Box, Text } from "ink";
import type { ClientOptions, OaClient } from "../client.ts";
import { COLORS } from "./theme.tsx";
import { Home, type Destination } from "./screens/Home.tsx";
import { Login } from "./screens/Login.tsx";
import { Chat } from "./screens/Chat.tsx";
import { Flows } from "./screens/Flows.tsx";
import { Agents } from "./screens/Agents.tsx";
import { Keys } from "./screens/Keys.tsx";

type Screen = "login" | "home" | "chat" | "flows" | "agents" | "keys";

interface Props {
  /** A ready client built from the stored profile, if the user is already logged in. */
  initialClient?: OaClient;
  configDir: string;
  defaultInstance?: string;
  makeClient: (opts: ClientOptions) => OaClient;
  onExit: () => void;
}

/** Top-level router. Each pane is dependency-injected with the active client and
 * an onBack/onError pair; `esc` backs out (handled per-screen), `q`/Ctrl-C quit. */
export const App: React.FC<Props> = ({ initialClient, configDir, defaultInstance, makeClient, onExit }) => {
  const [client, setClient] = useState<OaClient | undefined>(initialClient);
  const [screen, setScreen] = useState<Screen>(initialClient ? "home" : "login");
  const [error, setError] = useState<string>("");

  const onError = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const back = () => {
    setError("");
    setScreen("home");
  };

  // Login is its own root (it has no client yet).
  if (screen === "login" || !client) {
    return (
      <Box flexDirection="column">
        <Login
          configDir={configDir}
          defaultInstance={defaultInstance}
          makeClient={makeClient}
          onAuthenticated={(c) => {
            setClient(c);
            setError("");
            setScreen("home");
          }}
          onBack={() => (initialClient ? back() : onExit())}
          onError={onError}
        />
        <ErrorLine error={error} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {screen === "home" && (
        <Home client={client} onNavigate={(to: Destination) => setScreen(to)} onQuit={onExit} onError={onError} />
      )}
      {screen === "chat" && <Chat client={client} onBack={back} onError={onError} />}
      {screen === "flows" && <Flows client={client} onBack={back} onError={onError} />}
      {screen === "agents" && <Agents client={client} onBack={back} onError={onError} />}
      {screen === "keys" && <Keys client={client} onBack={back} onError={onError} />}
      <ErrorLine error={error} />
    </Box>
  );
};

const ErrorLine: React.FC<{ error: string }> = ({ error }) =>
  error ? (
    <Box paddingX={2}>
      <Text color={COLORS.err}>! {error}</Text>
    </Box>
  ) : null;
