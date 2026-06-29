import React from 'react';
import { motion } from 'framer-motion';
import { DocsShieldIcon } from '../components/DocsIcons';

const authMethods = [
  {
    title: 'Microsoft Entra ID (SSO)',
    desc: 'Enterprise SSO via Microsoft Entra ID (formerly Azure AD). Supports OpenID Connect with PKCE flow. Users authenticate through the Microsoft login page and are redirected back with an ID token. Groups and roles are synced from the directory.',
  },
  {
    title: 'Google Workspace',
    desc: 'OAuth 2.0 / OpenID Connect with Google Workspace. Supports domain-restricted login so only users from your Google Workspace organization can access the platform.',
  },
  {
    title: 'Generic OIDC',
    desc: 'Any OpenID Connect-compliant identity provider (Okta, Auth0, Keycloak, etc.) can be configured. The platform auto-discovers endpoints from the OIDC well-known URL.',
  },
  {
    title: 'API Keys',
    desc: 'Service-to-service authentication via long-lived API keys. Keys are scoped to specific permissions and can be rotated without downtime. Each key has an optional expiration date and usage limits.',
  },
];

const tokenTypes = [
  { token: 'Session Token', lifetime: '24 hours', use: 'Web UI sessions, auto-refreshed', storage: 'HttpOnly cookie' },
  { token: 'API Key', lifetime: 'Configurable', use: 'Service integrations, webhooks', storage: 'Database (hashed)' },
  { token: 'Refresh Token', lifetime: '30 days', use: 'Silent session renewal', storage: 'HttpOnly cookie' },
  { token: 'OIDC ID Token', lifetime: '1 hour', use: 'SSO identity assertion', storage: 'Memory only' },
];

const AuthenticationPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsShieldIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Authentication
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        OpenAgentic supports enterprise SSO providers, API keys for service integrations,
        and fine-grained token management. All authentication flows use industry-standard
        protocols (OAuth 2.0, OpenID Connect) with PKCE for browser-based flows.
      </p>
    </motion.div>

    {/* Auth Methods */}
    <motion.section style={{ marginBottom: '48px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Authentication Methods</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {authMethods.map((m) => (
          <div key={m.title} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '20px 24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' }}>{m.title}</h3>
            <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.65 }}>{m.desc}</p>
          </div>
        ))}
      </div>
    </motion.section>

    {/* Token Types */}
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Token Types</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
              {['Token', 'Lifetime', 'Use', 'Storage'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokenTypes.map((t, i) => (
              <tr key={t.token} style={{ borderBottom: i < tokenTypes.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text)' }}>{t.token}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{t.lifetime}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)' }}>{t.use}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textMuted)', fontSize: '12px' }}>{t.storage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>
  </div>
);

export default AuthenticationPage;
