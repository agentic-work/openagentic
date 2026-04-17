export const EDITION: 'oss' | 'enterprise' = 'oss';

export const UPGRADE_URL = 'https://agenticwork.io';

export const UPGRADE_MESSAGE = `Interested in the enterprise edition? ${UPGRADE_URL}`;

export function isEnterprise(): boolean {
  return (EDITION as string) === 'enterprise';
}

export function isOss(): boolean {
  return (EDITION as string) === 'oss';
}
