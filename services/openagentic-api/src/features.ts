export const EDITION: 'oss' | 'enterprise' = 'oss';

// Direct CTA — the lock screen in the UI sends users straight here.
export const UPGRADE_URL = 'https://agenticwork.io/purchase';
// Marketing page — for "learn more" secondary links.
export const MARKETING_URL = 'https://agenticwork.io';

export const UPGRADE_MESSAGE = `This feature is part of the hosted edition. ${UPGRADE_URL}`;

export function isEnterprise(): boolean {
  return (EDITION as string) === 'enterprise';
}

export function isOss(): boolean {
  return (EDITION as string) === 'oss';
}
