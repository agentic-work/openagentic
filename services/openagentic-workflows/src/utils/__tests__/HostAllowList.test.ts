import { describe, it, expect } from 'vitest';
import {
  denyIfPrivate,
  isAllowedInternalHost,
  isAllowedExternalHost,
  EgressBlockedError,
} from '../HostAllowList.js';

/**
 * Substrate-fix S4 (spec §3): SSRF + IMDS + RFC1918 deny + explicit
 * allowlist for X-Internal-Secret injection in WorkflowExecutionEngine.
 */
describe('HostAllowList', () => {
  describe('denyIfPrivate', () => {
    it('rejects 169.254.169.254 (IMDS)', async () => {
      await expect(denyIfPrivate('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(EgressBlockedError);
      await expect(denyIfPrivate('http://169.254.169.254/')).rejects.toThrow(/imds/);
    });
    it('rejects metadata.google.internal', async () => {
      await expect(denyIfPrivate('http://metadata.google.internal/')).rejects.toThrow(/imds/);
    });
    it('rejects metadata.azure.com', async () => {
      await expect(denyIfPrivate('http://metadata.azure.com/')).rejects.toThrow(/imds/);
    });
    it('rejects RFC1918 10.x by IP', async () => {
      await expect(denyIfPrivate('http://10.0.0.1/')).rejects.toThrow(/rfc1918/);
    });
    it('rejects RFC1918 172.16-31.x by IP', async () => {
      await expect(denyIfPrivate('http://172.20.5.5/')).rejects.toThrow(/rfc1918/);
    });
    it('rejects RFC1918 192.168.x by IP', async () => {
      await expect(denyIfPrivate('http://192.168.1.1/')).rejects.toThrow(/rfc1918/);
    });
    it('rejects loopback 127.x', async () => {
      await expect(denyIfPrivate('http://127.0.0.1/')).rejects.toThrow(/loopback/);
    });
    it('rejects link-local 169.254.x by IP (non-IMDS-host)', async () => {
      await expect(denyIfPrivate('http://169.254.1.1/')).rejects.toThrow(/imds/);
    });
    it('rejects .svc.cluster.local suffix', async () => {
      await expect(denyIfPrivate('http://x.openagentic.svc.cluster.local/')).rejects.toThrow(/cluster_local/);
    });
    it('allows public 8.8.8.8', async () => {
      await expect(denyIfPrivate('http://8.8.8.8/')).resolves.toBeUndefined();
    });
  });

  describe('isAllowedInternalHost', () => {
    it('returns true for exact match', async () => {
      const ok = await isAllowedInternalHost(
        new URL('http://openagentic-api.openagentic.svc.cluster.local:3001/health'),
        ['openagentic-api.openagentic.svc.cluster.local'],
      );
      expect(ok).toBe(true);
    });
    it('returns false for substring-match attempt (foo.evil.com)', async () => {
      const ok = await isAllowedInternalHost(
        new URL('http://openagentic-api.evil.com/'),
        ['openagentic-api.openagentic.svc.cluster.local'],
      );
      expect(ok).toBe(false);
    });
    it('returns false when allowlist empty', async () => {
      const ok = await isAllowedInternalHost(new URL('http://anything/'), []);
      expect(ok).toBe(false);
    });
  });

  describe('isAllowedExternalHost', () => {
    it('returns true for exact match', async () => {
      expect(await isAllowedExternalHost('https://api.example.com/path', ['api.example.com'])).toBe(true);
    });
    it('returns true for wildcard suffix match', async () => {
      expect(await isAllowedExternalHost('https://foo.example.com/', ['*.example.com'])).toBe(true);
      expect(await isAllowedExternalHost('https://example.com/', ['*.example.com'])).toBe(true);
    });
    it('returns false for non-matching host', async () => {
      expect(await isAllowedExternalHost('https://evil.com/', ['*.example.com'])).toBe(false);
    });
  });
});
