// Edition marker. The OSS build is fully functional with no gated features
// or upsell surfaces — this flag is retained only as a harmless build label.
export const EDITION: 'oss' | 'enterprise' = 'oss';

export function isEnterprise(): boolean {
  return (EDITION as string) === 'enterprise';
}

export function isOss(): boolean {
  return (EDITION as string) === 'oss';
}
