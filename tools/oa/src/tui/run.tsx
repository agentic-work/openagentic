import React from "react";
import { render } from "ink";
import { OaClient, type ClientOptions } from "../client.ts";
import { configDir as resolveConfigDir, getProfile } from "../config.ts";
import { App } from "./app.tsx";

export interface TuiOptions {
  profile?: string;
  instance?: string;
}

/** Launch the interactive Ink TUI. This is the ONLY render() call; it is loaded
 * lazily (dynamic import from cli.ts) so the scripting fast-path never pays the
 * React/Ink import cost. */
/* c8 ignore start — interactive terminal render, exercised live not in unit tests */
export async function runTui(opts: TuiOptions = {}): Promise<void> {
  const dir = resolveConfigDir();
  const profile = getProfile(dir, opts.profile);
  const instanceUrl = opts.instance ?? profile?.instanceUrl;
  const makeClient = (o: ClientOptions): OaClient => new OaClient(o);
  // Only treat the user as logged in when a stored api key exists; otherwise
  // start at Login (with any known instance prefilled).
  const initialClient = profile?.apiKey
    ? makeClient({ instanceUrl: instanceUrl ?? profile.instanceUrl, token: profile.apiKey })
    : undefined;

  const { waitUntilExit } = render(
    <App
      initialClient={initialClient}
      configDir={dir}
      defaultInstance={instanceUrl}
      makeClient={makeClient}
      onExit={() => process.exit(0)}
    />,
  );
  await waitUntilExit();
}
/* c8 ignore stop */
