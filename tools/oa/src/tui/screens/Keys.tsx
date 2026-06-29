import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { ApiKeyInfo, OaClient } from "../../client.ts";
import { COLORS, Frame, Hint } from "../theme.tsx";

interface Props {
  client: OaClient;
  onBack: () => void;
  onError: (err: unknown) => void;
}

type Mode = "list" | "create" | "created" | "confirm" | "busy";

const CREATE = "__create";
const BACK = "__back";

/** Manage user-bound api keys: list, create (plaintext shown ONCE), and
 * revoke-with-confirmation. */
export const Keys: React.FC<Props> = ({ client, onBack, onError }) => {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("list");
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [pending, setPending] = useState<{ id: string; name: string } | undefined>();

  const reload = useCallback(() => {
    setLoading(true);
    return client
      .listApiKeys()
      .then((k) => setKeys(k))
      .catch(onError)
      .finally(() => setLoading(false));
  }, [client, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Key handling that the mounted SelectInput/TextInput don't own.
  useInput((input, key) => {
    if (mode === "list" && key.escape) {
      onBack();
      return;
    }
    if (mode === "created" && (key.return || key.escape)) {
      setMode("list");
      void reload();
      return;
    }
    if (mode === "confirm") {
      if (input === "y" || input === "Y") void revoke();
      else if (key.escape || input === "n" || input === "N") setMode("list");
    }
  });

  async function create(): Promise<void> {
    const n = name.trim();
    if (!n) return;
    setMode("busy");
    try {
      const created = await client.createApiKey(n);
      setPlaintext(created.plaintext_key);
      setName("");
      setMode("created");
    } catch (err) {
      onError(err);
      setMode("list");
    }
  }

  async function revoke(): Promise<void> {
    if (!pending) return;
    const id = pending.id;
    setMode("busy");
    try {
      await client.revokeApiKey(id);
      setPending(undefined);
      await reload();
      setMode("list");
    } catch (err) {
      onError(err);
      setMode("list");
    }
  }

  if (mode === "busy") {
    return (
      <Frame title="Keys">
        <Text color={COLORS.muted}>
          <Spinner type="dots" /> working…
        </Text>
      </Frame>
    );
  }

  if (mode === "created") {
    return (
      <Frame title="Keys">
        <Box flexDirection="column">
          <Text color={COLORS.warn}>Save this key now — it will not be shown again:</Text>
          <Text color={COLORS.ok} bold>
            {plaintext}
          </Text>
          <Box marginTop={1}>
            <Hint>Enter / esc to continue</Hint>
          </Box>
        </Box>
      </Frame>
    );
  }

  if (mode === "create") {
    return (
      <Frame title="Keys">
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.accent}>name: </Text>
            <TextInput value={name} onChange={setName} onSubmit={() => void create()} />
          </Box>
          <Box marginTop={1}>
            <Hint>Enter to create</Hint>
          </Box>
        </Box>
      </Frame>
    );
  }

  if (mode === "confirm" && pending) {
    return (
      <Frame title="Keys">
        <Text color={COLORS.warn}>
          Revoke api key {pending.name} ({pending.id})? [y/N]
        </Text>
      </Frame>
    );
  }

  return (
    <Frame title="Keys">
      {loading ? (
        <Text color={COLORS.muted}>
          <Spinner type="dots" /> loading keys…
        </Text>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="column" marginBottom={1}>
            {keys.length === 0 ? (
              <Hint>No api keys yet.</Hint>
            ) : (
              keys.map((k) => (
                <Text key={k.id} color={COLORS.muted}>
                  {k.id} · {k.name} · last used {k.last_used_at ?? "never"}
                </Text>
              ))
            )}
          </Box>
          <SelectInput
            items={[
              { label: "Create new key", value: CREATE },
              ...keys.map((k) => ({ label: `Revoke ${k.name}`, value: k.id })),
              { label: "Back", value: BACK },
            ]}
            onSelect={(item) => {
              if (item.value === CREATE) {
                setMode("create");
              } else if (item.value === BACK) {
                onBack();
              } else {
                const k = keys.find((x) => x.id === item.value);
                if (k) {
                  setPending({ id: k.id, name: k.name });
                  setMode("confirm");
                }
              }
            }}
            indicatorComponent={({ isSelected }) => (
              <Text color={COLORS.accent}>{isSelected ? "❯ " : "  "}</Text>
            )}
          />
        </Box>
      )}
    </Frame>
  );
};
