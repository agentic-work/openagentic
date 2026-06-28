import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { OaClient, Workflow } from "../../client.ts";
import { COLORS, Frame, Hint } from "../theme.tsx";

interface Props {
  client: OaClient;
  onBack: () => void;
  onError: (err: unknown) => void;
}

type Mode = "list" | "input" | "running" | "done";

/** Browse flows (workflows) and run the highlighted one. Optionally provide a
 * JSON input object (press `i` before selecting) before executing. */
export const Flows: React.FC<Props> = ({ client, onBack, onError }) => {
  const [flows, setFlows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("list");
  const [jsonInput, setJsonInput] = useState("");
  const [result, setResult] = useState<{ executionId?: string; status?: string } | undefined>();

  useEffect(() => {
    let alive = true;
    client
      .listWorkflows()
      .then((w) => {
        if (alive) setFlows(w);
      })
      .catch(onError)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [client, onError]);

  // `esc` always backs out; `i` (in list mode) opens the optional JSON input.
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (mode === "list" && input === "i") setMode("input");
  });

  async function run(flow: Workflow): Promise<void> {
    setMode("running");
    let parsed: Record<string, unknown> | undefined;
    if (jsonInput.trim()) {
      try {
        parsed = JSON.parse(jsonInput);
      } catch {
        onError(new Error("Input is not valid JSON"));
        setMode("list");
        return;
      }
    }
    try {
      const res = await client.executeWorkflow(flow.id, parsed);
      setResult(res);
      setMode("done");
    } catch (err) {
      onError(err);
      setMode("list");
    }
  }

  return (
    <Frame title="Flows">
      {loading ? (
        <Text color={COLORS.muted}>
          <Spinner type="dots" /> loading flows…
        </Text>
      ) : flows.length === 0 ? (
        <Text color={COLORS.muted}>No flows.</Text>
      ) : mode === "done" && result ? (
        <Box flexDirection="column">
          <Text color={COLORS.ok}>
            execution {result.executionId ?? "?"}
            {result.status ? ` (${result.status})` : ""}
          </Text>
          <Box marginTop={1}>
            <Hint>esc to go back</Hint>
          </Box>
        </Box>
      ) : mode === "running" ? (
        <Text color={COLORS.muted}>
          <Spinner type="dots" /> running…
        </Text>
      ) : mode === "input" ? (
        <Box flexDirection="column">
          <Text color={COLORS.accent}>JSON input (optional):</Text>
          <TextInput value={jsonInput} onChange={setJsonInput} onSubmit={() => setMode("list")} />
          <Box marginTop={1}>
            <Hint>Enter to keep, then pick a flow to run it.</Hint>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={flows.map((f) => ({ label: f.name, value: f.id }))}
            onSelect={(item) => {
              const flow = flows.find((f) => f.id === item.value);
              if (flow) void run(flow);
            }}
            indicatorComponent={({ isSelected }) => (
              <Text color={COLORS.accent}>{isSelected ? "❯ " : "  "}</Text>
            )}
          />
          <Box marginTop={1}>
            <Hint>Enter to run · i to add JSON input · esc to go back</Hint>
          </Box>
        </Box>
      )}
    </Frame>
  );
};
