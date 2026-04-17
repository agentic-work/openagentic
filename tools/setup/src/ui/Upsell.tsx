import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './Theme.tsx';

export const UPGRADE_URL = 'https://agenticwork.io';

interface UpsellCardProps {
  feature: string;
  reason?: string;
}

export const UpsellCard: React.FC<UpsellCardProps> = ({ feature, reason }) => (
  <Box flexDirection="column" borderStyle="round" borderColor={COLORS.accent} paddingX={2} paddingY={0}>
    <Text color={COLORS.accent} bold>
      Enterprise edition
    </Text>
    <Text>{feature}</Text>
    {reason && <Text color={COLORS.muted}>{reason}</Text>}
    <Text color={COLORS.muted}>
      Interested? → <Text color={COLORS.accent}>{UPGRADE_URL}</Text>
    </Text>
  </Box>
);

export const UpsellHint: React.FC<{ feature: string }> = ({ feature }) => (
  <Text color={COLORS.muted}>
    {feature} requires the Enterprise edition — <Text color={COLORS.accent}>{UPGRADE_URL}</Text>
  </Text>
);
