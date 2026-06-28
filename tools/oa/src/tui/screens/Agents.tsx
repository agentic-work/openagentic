import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { Agent, OaClient } from "../../client.ts";
import { COLORS, Frame, Hint } from "../theme.tsx";

interface Props {
  client: OaClient;
  onBack: () => void;
  onError: (err: unknown) => void;
}

type Mode = "list" | "task" | "running" | "done";

/** Browse registered agents and run the selected one on a task. */
export const Agents: React.FC<Props> = ({ client, onBack, onError }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("list");
  const [selected, setSelected] = useState<Agent | undefined>();
  const [task, setTask] = useState("");
  const [executionId, setExecutionId] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    client
      .listAgents()
      .then((a) => {
        if (alive) setAgents(a);
      })
      .catch(onError)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [client, onError]);

  useInput((_input, key) => {
    if (key.escape) {
      if (mode === "task") setMode("list");
      else onBack();
    }
  });

  async function run(): Promise<void> {
    if (!selected || !task.trim()) return;
    setMode("running");
    try {
      const res = await client.executeAgent(selected.id, task.trim());
      setExecutionId(res.executionId);
      setMode("done");
    } catch (err) {
      onError(err);
      setMode("list");
    }
  }

  return (
    <Frame title="Agents">
      {loading ? (
        <Text color={COLORS.muted}>
          <Spinner type="dots" /> loading agents…
        </Text>
      ) : agents.length === 0 ? (
        <Text color={COLORS.muted}>No agents.</Text>
      ) : mode === "done" ? (
        <Box flexDirection="column">
          <Text color={COLORS.ok}>execution {executionId ?? "?"}</Text>
          <Box marginTop={1}>
            <Hint>esc to go back</Hint>
          </Box>
        </Box>
      ) : mode === "running" ? (
        <Text color={COLORS.muted}>
          <Spinner type="dots" /> running…
        </Text>
      ) : mode === "task" && selected ? (
        <Box flexDirection="column">
          <Text color={COLORS.accent}>Task for {selected.name}:</Text>
          <TextInput value={task} onChange={setTask} onSubmit={() => void run()} />
          <Box marginTop={1}>
            <Hint>Enter to run · esc to go back</Hint>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={agents.map((a) => ({ label: a.name, value: a.id }))}
            onSelect={(item) => {
              const agent = agents.find((a) => a.id === item.value);
              if (agent) {
                setSelected(agent);
                setMode("task");
              }
            }}
            indicatorComponent={({ isSelected }) => (
              <Text color={COLORS.accent}>{isSelected ? "❯ " : "  "}</Text>
            )}
          />
          <Box marginTop={1}>
            <Hint>Enter to choose · esc to go back</Hint>
          </Box>
        </Box>
      )}
    </Frame>
  );
};
