/**
 * Shared Provider Icons — Used by ModelManagementView, LLMProviderManagement, and chat.
 * Real vendor SVGs from src/assets/icons/ai-brands/ (imported as raw strings so
 * currentColor inheritance works). No PNG files, no missing-asset placeholders.
 *
 * Note: SVG content is statically imported at build time from trusted local
 * repo assets — not user input — so dangerouslySetInnerHTML is safe here.
 */
import React from 'react';

// Raw SVG imports — Vite returns the file contents as a string.
import AnthropicSvg from '@/assets/icons/ai-brands/Anthropic.svg?raw';
import AwsSvg from '@/assets/icons/ai-brands/Aws.svg?raw';
import AzureSvg from '@/assets/icons/ai-brands/Azure.svg?raw';
import ClaudeSvg from '@/assets/icons/ai-brands/Claude.svg?raw';
import CohereSvg from '@/assets/icons/ai-brands/Cohere.svg?raw';
import GeminiSvg from '@/assets/icons/ai-brands/Gemini.svg?raw';
import GoogleSvg from '@/assets/icons/ai-brands/Google.svg?raw';
import GroqSvg from '@/assets/icons/ai-brands/Groq.svg?raw';
import MetaSvg from '@/assets/icons/ai-brands/Meta.svg?raw';
import MistralSvg from '@/assets/icons/ai-brands/Mistral.svg?raw';
import OllamaSvg from '@/assets/icons/ai-brands/Ollama.svg?raw';
import OpenAISvg from '@/assets/icons/ai-brands/OpenAI.svg?raw';

// Inline-SVG wrapper. The raw SVG text already has width/height/viewBox attrs —
// we wrap it in a span sized to the requested dimension, and let currentColor
// drive the fill from the parent's text color.
const InlineSvg: React.FC<{ svg: string; size?: number; color?: string; title: string }> = ({
  svg, size = 18, color, title,
}) => {
  const sized = svg
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`);
  return (
    <span
      aria-label={title}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        color: color || 'currentColor',
        flexShrink: 0,
      }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
};

// ── Named exports for direct use ────────────────────────────────────────────

export const AzureIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={AzureSvg} size={size} color="#0078D4" title="Azure" />
);

// Azure AI Foundry doesn't have a distinct brand mark — reuse Azure
export const AzureAIIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={AzureSvg} size={size} color="#0078D4" title="Azure AI Foundry" />
);

// Vertex AI uses Google brand
export const VertexAIIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={GoogleSvg} size={size} title="Vertex AI" />
);

export const GoogleIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={GoogleSvg} size={size} title="Google" />
);

export const GeminiIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={GeminiSvg} size={size} color="#3186FF" title="Gemini" />
);

export const AWSIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={AwsSvg} size={size} color="#FF9900" title="AWS" />
);

// Bedrock uses AWS brand
export const BedrockIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={AwsSvg} size={size} color="#FF9900" title="AWS Bedrock" />
);

export const OllamaIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={OllamaSvg} size={size} color="var(--text-primary, #fff)" title="Ollama" />
);

export const AnthropicIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={AnthropicSvg} size={size} color="#D4A574" title="Anthropic" />
);

export const ClaudeIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={ClaudeSvg} size={size} color="#D4A574" title="Claude" />
);

export const OpenAIIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={OpenAISvg} size={size} color="#10A37F" title="OpenAI" />
);

export const MistralIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={MistralSvg} size={size} color="#FF8205" title="Mistral" />
);

export const CohereIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={CohereSvg} size={size} color="#39594D" title="Cohere" />
);

export const MetaIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={MetaSvg} size={size} color="#0082FB" title="Meta" />
);

export const GroqIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <InlineSvg svg={GroqSvg} size={size} color="#F55036" title="Groq" />
);

// ── Icon + color lookup maps ─────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  'azure-openai': 'var(--provider-azure, #0078D4)',
  'azure-ai-foundry': 'var(--provider-azure, #0078D4)',
  'vertex-ai': 'var(--provider-google, #4285F4)',
  'google-vertex': 'var(--provider-google, #4285F4)',
  google: 'var(--provider-google, #4285F4)',
  gemini: '#3186FF',
  'aws-bedrock': 'var(--provider-aws, #FF9900)',
  aws: 'var(--provider-aws, #FF9900)',
  ollama: 'var(--provider-ollama, #22C55E)',
  anthropic: 'var(--provider-anthropic, #D4A574)',
  openai: 'var(--provider-openai, #10A37F)',
  mistral: '#FF8205',
  cohere: '#39594D',
  meta: '#0082FB',
  groq: '#F55036',
};

/**
 * Get the brand icon for a provider type string.
 * Handles fuzzy matching (e.g. "azure-openai", "aws", "claude").
 */
export function getProviderIcon(providerType: string, size?: number): React.ReactNode {
  const t = providerType?.toLowerCase() || '';
  if (t.includes('foundry')) return <AzureAIIcon size={size} />;
  if (t.includes('azure')) return <AzureIcon size={size} />;
  if (t.includes('vertex')) return <VertexAIIcon size={size} />;
  if (t.includes('gemini')) return <GeminiIcon size={size} />;
  if (t.includes('google')) return <GoogleIcon size={size} />;
  if (t.includes('bedrock')) return <BedrockIcon size={size} />;
  if (t.includes('aws')) return <AWSIcon size={size} />;
  if (t.includes('ollama')) return <OllamaIcon size={size} />;
  if (t.includes('claude')) return <ClaudeIcon size={size} />;
  if (t.includes('anthropic')) return <AnthropicIcon size={size} />;
  if (t.includes('openai') || t.includes('gpt')) return <OpenAIIcon size={size} />;
  if (t.includes('mistral')) return <MistralIcon size={size} />;
  if (t.includes('cohere')) return <CohereIcon size={size} />;
  if (t.includes('meta') || t.includes('llama')) return <MetaIcon size={size} />;
  if (t.includes('groq')) return <GroqIcon size={size} />;
  // Fallback: generic server icon
  const s = size || 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
      <line x1="6" y1="6" x2="6.01" y2="6"/>
      <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
  );
}

/**
 * Get the brand color CSS variable for a provider type string.
 */
export function getProviderColor(providerType: string): string {
  const t = providerType?.toLowerCase() || '';
  if (t.includes('foundry')) return PROVIDER_COLORS['azure-ai-foundry'];
  if (t.includes('azure')) return PROVIDER_COLORS['azure-openai'];
  if (t.includes('vertex')) return PROVIDER_COLORS['vertex-ai'];
  if (t.includes('gemini')) return PROVIDER_COLORS['gemini'];
  if (t.includes('google')) return PROVIDER_COLORS['google'];
  if (t.includes('bedrock')) return PROVIDER_COLORS['aws-bedrock'];
  if (t.includes('aws')) return PROVIDER_COLORS['aws'];
  if (t.includes('ollama')) return PROVIDER_COLORS['ollama'];
  if (t.includes('anthropic') || t.includes('claude')) return PROVIDER_COLORS['anthropic'];
  if (t.includes('openai') || t.includes('gpt')) return PROVIDER_COLORS['openai'];
  if (t.includes('mistral')) return PROVIDER_COLORS['mistral'];
  if (t.includes('cohere')) return PROVIDER_COLORS['cohere'];
  if (t.includes('meta') || t.includes('llama')) return PROVIDER_COLORS['meta'];
  if (t.includes('groq')) return PROVIDER_COLORS['groq'];
  return '#6b7280';
}
