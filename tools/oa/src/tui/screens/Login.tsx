import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { ClientOptions, OaClient } from "../../client.ts";
import { loadConfig, saveProfile } from "../../config.ts";
import { COLORS, Frame, Hint } from "../theme.tsx";

interface Props {
  configDir: string;
  defaultInstance?: string;
  makeClient: (opts: ClientOptions) => OaClient;
  onAuthenticated: (client: OaClient) => void;
  onBack: () => void;
  onError: (err: unknown) => void;
}

type Field = "instance" | "username" | "password";

const ADD_NEW = "__add_new";

/** Authenticate. If stored profiles exist, pick one (default highlighted);
 * otherwise an inline form mints a user-bound, revocable api key and persists
 * ONLY the key (never the short-lived JWT) — identical to `oa login`. */
export const Login: React.FC<Props> = ({
  configDir,
  defaultInstance,
  makeClient,
  onAuthenticated,
  onBack,
  onError,
}) => {
  const cfg = loadConfig(configDir);
  const profileNames = Object.keys(cfg.profiles);
  const [picking, setPicking] = useState(profileNames.length > 0);

  const [instance, setInstance] = useState(defaultInstance ?? "http://localhost:8080");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [field, setField] = useState<Field>("instance");
  const [busy, setBusy] = useState(false);
  const [uiHint, setUiHint] = useState<string>("");

  // Best-effort: tell the user whether the target serves the web UI.
  useEffect(() => {
    let alive = true;
    makeClient({ instanceUrl: instance })
      .detectUi()
      .then((hasUi) => {
        if (alive) setUiHint(hasUi ? "Detected web UI at this instance." : "Headless instance.");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [instance, makeClient]);

  useInput((_input, key) => {
    if (key.escape && !busy) onBack();
  });

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const loginClient = makeClient({ instanceUrl: instance });
      const { token } = await loginClient.login(username, password);
      const authedTmp = makeClient({ instanceUrl: instance, token });
      const key = await authedTmp.createApiKey("oa-cli");
      // Persist the api key — NEVER the JWT.
      saveProfile(configDir, "default", { instanceUrl: instance, apiKey: key.plaintext_key }, true);
      onAuthenticated(makeClient({ instanceUrl: instance, token: key.plaintext_key }));
    } catch (err) {
      onError(err);
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <Frame title="Login">
        <Text color={COLORS.muted}>
          <Spinner type="dots" /> authenticating…
        </Text>
      </Frame>
    );
  }

  if (picking) {
    const defaultIndex = Math.max(0, profileNames.indexOf(cfg.defaultProfile));
    return (
      <Frame title="Login">
        <Box flexDirection="column">
          <Hint>Pick a saved profile, or add a new instance.</Hint>
          <Box marginTop={1}>
            <SelectInput
              initialIndex={defaultIndex}
              items={[
                ...profileNames.map((n) => ({ label: `${n}  (${cfg.profiles[n].instanceUrl})`, value: n })),
                { label: "Add a new instance", value: ADD_NEW },
              ]}
              onSelect={(item) => {
                if (item.value === ADD_NEW) {
                  setPicking(false);
                  return;
                }
                const p = cfg.profiles[item.value];
                onAuthenticated(makeClient({ instanceUrl: p.instanceUrl, token: p.apiKey }));
              }}
              indicatorComponent={({ isSelected }) => (
                <Text color={COLORS.accent}>{isSelected ? "❯ " : "  "}</Text>
              )}
            />
          </Box>
        </Box>
      </Frame>
    );
  }

  const row = (label: string, active: boolean, node: React.ReactNode) => (
    <Box>
      <Text color={active ? COLORS.accent : COLORS.muted}>
        {active ? "❯ " : "  "}
        {label}
      </Text>
      <Text>{"  "}</Text>
      {node}
    </Box>
  );

  return (
    <Frame title="Login">
      <Box flexDirection="column">
        {row(
          "instance :",
          field === "instance",
          field === "instance" ? (
            <TextInput value={instance} onChange={setInstance} onSubmit={() => setField("username")} />
          ) : (
            <Text>{instance}</Text>
          ),
        )}
        {row(
          "username :",
          field === "username",
          field === "username" ? (
            <TextInput value={username} onChange={setUsername} onSubmit={() => setField("password")} />
          ) : (
            <Text>{username}</Text>
          ),
        )}
        {row(
          "password :",
          field === "password",
          field === "password" ? (
            <TextInput value={password} onChange={setPassword} mask="•" onSubmit={() => void submit()} />
          ) : (
            <Text>{"•".repeat(Math.min(password.length, 12))}</Text>
          ),
        )}
        <Box marginTop={1}>
          <Hint>{uiHint || "Mints a user-bound api key; only the key is stored. esc to go back."}</Hint>
        </Box>
      </Box>
    </Frame>
  );
};
