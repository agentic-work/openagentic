import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { OaClient } from "../client.ts";
import { App } from "./app.tsx";

const delay = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DOWN = "\u001B[B"; // ANSI down-arrow escape
const ESC = "\u001B"; // escape key

function fakeClient(): OaClient {
  return {
    whoami: async () => ({ userId: "u1", email: "admin@example.com", isAdmin: true, groups: [], authMethod: "api-key" }),
    health: async () => ({ status: "ok" }),
    listWorkflows: async () => [],
    listAgents: async () => [],
    listApiKeys: async () => [],
  } as unknown as OaClient;
}

describe("App router", () => {
  it("starts on Home (when a client is provided) and shows the menu", async () => {
    const { lastFrame } = render(
      <App initialClient={fakeClient()} configDir="/tmp/none" makeClient={(o) => o as unknown as OaClient} onExit={() => {}} />,
    );
    await delay();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("admin@example.com");
    expect(frame).toContain("Chat");
    expect(frame).toContain("Switch profile");
  });

  it("navigates Home → Flows on arrow+enter and back on esc", async () => {
    const { lastFrame, stdin } = render(
      <App initialClient={fakeClient()} configDir="/tmp/none" makeClient={(o) => o as unknown as OaClient} onExit={() => {}} />,
    );
    await delay();
    stdin.write(DOWN); // Chat → Flows
    await delay();
    stdin.write("\r"); // enter Flows
    await delay();
    expect(lastFrame()).toContain("No flows."); // unique to the Flows screen (empty list)

    stdin.write(ESC); // back to Home
    await delay();
    expect(lastFrame()).toContain("Switch profile"); // unique to the Home menu
  });

  it("quits on `q` from Home", async () => {
    let exited = false;
    const { stdin } = render(
      <App
        initialClient={fakeClient()}
        configDir="/tmp/none"
        makeClient={(o) => o as unknown as OaClient}
        onExit={() => {
          exited = true;
        }}
      />,
    );
    await delay();
    stdin.write("q");
    await delay();
    expect(exited).toBe(true);
  });
});
