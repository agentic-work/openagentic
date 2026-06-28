import React from "react";
import { Box, Text } from "ink";

/**
 * Slim, LOCAL copy of the openagentics.io brand palette.
 *
 * This is INTENTIONALLY duplicated from tools/setup/src/ui/Theme.tsx rather than
 * imported across packages — `oa` and the install wizard are separate npm
 * packages with their own bundles, and a cross-package import would couple them.
 * IMPORTANT: a brand-color change must be made in BOTH places to stay in sync.
 */
export const COLORS = {
  accent: "#88CCA0", // moss --signal-ink (heading accent on dark)
  accentDeep: "#5FA877", // moss --signal (primary accent)
  ink: "#F3F1EC", // terminal cream text
  muted: "#7E927E", // dusty tan
  faint: "#56654F", // deeper dusty tan
  ok: "#88CCA0", // success moss
  warn: "#D9AE52", // amber status LED
  err: "#E0663A", // hot burnt-orange alert
  signal: "#DB8240", // burnt-orange brand LED (active markers)
} as const;

const width = (): number => Math.max(40, Math.min((process.stdout.columns || 80) - 6, 88));

/** The brand masthead: ⌥ · openagentic + a hairline rule. */
export const Banner: React.FC<{ subtitle?: string }> = ({ subtitle }) => {
  const w = width();
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box width={w} justifyContent="space-between">
        <Box>
          <Text color={COLORS.accent} bold>
            ⌥
          </Text>
          <Text color={COLORS.signal} bold>
            {" "}·{" "}
          </Text>
          <Text color={COLORS.accentDeep} bold>
            openagentic
          </Text>
        </Box>
        <Text color={COLORS.faint}>headless control plane</Text>
      </Box>
      <Text color={COLORS.faint}>{"─".repeat(w)}</Text>
      {subtitle ? <Text color={COLORS.muted}>{subtitle}</Text> : null}
    </Box>
  );
};

/** A titled frame wrapper used by every screen. */
export const Frame: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box flexDirection="column" paddingX={2}>
    <Banner subtitle={title} />
    <Box flexDirection="column" marginTop={1}>
      {children}
    </Box>
  </Box>
);

/** Muted hint line. */
export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text color={COLORS.muted}>{children}</Text>
);
