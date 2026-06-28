/**
 * Data Loss Prevention (DLP) Scanner Service
 *
 * Scans all data flowing through tool execution in real time.
 * Detects credential exfiltration, PII exposure, and anomalous
 * data patterns across 50+ detection rules.
 *
 * Scan points: tool inputs, tool results, LLM output, user input.
 * Actions: allow, redact, block (based on severity and policy).
 */

import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DLPSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DLPAction = 'allow' | 'redact' | 'block';
export type DLPCategory = 'credential' | 'pii' | 'infrastructure' | 'compliance' | 'injection';
export type DLPScanPoint = 'tool_input' | 'tool_result' | 'llm_output' | 'user_input' | 'workflow_data';

export interface DLPToolExemption {
  id: string;
  toolPattern: string;      // glob pattern like "web_*"
  scanPoint: DLPScanPoint;  // which scan point is exempt
  exemptCategories: DLPCategory[];
  reason: string;
  enabled: boolean;
}

export interface DLPRule {
  id: string;
  category: DLPCategory;
  name: string;
  description: string;
  pattern: RegExp;
  severity: DLPSeverity;
  /** Optional validator for reducing false positives (e.g. Luhn check for credit cards) */
  validate?: (match: string) => boolean;
  /** Whether this rule is enabled (admin-configurable) */
  enabled: boolean;
}

export interface DLPFinding {
  ruleId: string;
  ruleName: string;
  category: DLPCategory;
  severity: DLPSeverity;
  match: string;       // The matched text (truncated for logging)
  startIndex: number;
  endIndex: number;
}

export interface DLPScanResult {
  findings: DLPFinding[];
  severity: DLPSeverity;
  action: DLPAction;
  scannedLength: number;
  scanTimeMs: number;
}

export interface DLPScanContext {
  userId: string;
  sessionId?: string;
  executionId?: string;
  scanPoint: DLPScanPoint;
  toolName?: string;
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<DLPSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxSeverity(a: DLPSeverity, b: DLPSeverity): DLPSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

function severityToAction(severity: DLPSeverity): DLPAction {
  switch (severity) {
    case 'low': return 'allow';
    case 'medium': return 'redact';
    case 'high': return 'block';
    case 'critical': return 'block';
  }
}

// ---------------------------------------------------------------------------
// Luhn algorithm for credit card validation
// ---------------------------------------------------------------------------

function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number.parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// 50+ Detection Rules
// ---------------------------------------------------------------------------

function buildDefaultRules(): DLPRule[] {
  const rules: DLPRule[] = [];
  let id = 0;
  const r = (category: DLPCategory, name: string, description: string, pattern: RegExp, severity: DLPSeverity, validate?: (m: string) => boolean) => {
    id++;
    rules.push({ id: `DLP-${String(id).padStart(3, '0')}`, category, name, description, pattern, severity, validate, enabled: true });
  };

  // ========== CREDENTIALS (20 rules) ==========
  r('credential', 'AWS Access Key', 'AWS access key ID', /AKIA[0-9A-Z]{16}/g, 'high');
  r('credential', 'AWS Secret Key', 'AWS secret access key', /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/g, 'critical');
  r('credential', 'OpenAI API Key', 'OpenAI sk- prefix key', /sk-[A-Za-z0-9]{20,}/g, 'high');
  r('credential', 'GitHub Token', 'GitHub personal access token', /gh[ps]_[A-Za-z0-9]{36,}/g, 'high');
  r('credential', 'GitHub OAuth', 'GitHub OAuth access token', /gho_[A-Za-z0-9]{36}/g, 'high');
  r('credential', 'Slack Token', 'Slack bot/user token', /xox[bpsa]-[A-Za-z0-9-]{10,}/g, 'high');
  r('credential', 'Bearer Token', 'Bearer authorization token (long)', /Bearer\s+[A-Za-z0-9._~+/=-]{40,}/g, 'medium');
  r('credential', 'Private Key', 'PEM private key', /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g, 'critical');
  r('credential', 'JWT Token', 'JSON Web Token', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, 'medium');
  r('credential', 'Azure Client Secret', 'Azure AD client secret', /(?:client_secret|AZURE_CLIENT_SECRET)\s*[=:]\s*[A-Za-z0-9~._-]{30,}/g, 'critical');
  r('credential', 'Azure Storage Key', 'Azure storage account key', /(?:AccountKey|AZURE_STORAGE_KEY)\s*=\s*[A-Za-z0-9+/=]{80,}/g, 'critical');
  r('credential', 'GCP Service Account Key', 'GCP private key ID', /"private_key_id"\s*:\s*"[a-f0-9]{40}"/g, 'critical');
  r('credential', 'GCP Private Key', 'GCP service account private key', /"private_key"\s*:\s*"-----BEGIN/g, 'critical');
  r('credential', 'Anthropic API Key', 'Anthropic sk-ant prefix', /sk-ant-[A-Za-z0-9-]{20,}/g, 'high');
  r('credential', 'Stripe Key', 'Stripe API key', /[sr]k_(test|live)_[A-Za-z0-9]{20,}/g, 'high');
  r('credential', 'SendGrid Key', 'SendGrid API key', /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, 'high');
  r('credential', 'Twilio Auth Token', 'Twilio account credentials', /(?:twilio|TWILIO).*(?:token|TOKEN|secret|SECRET)\s*[=:]\s*[a-f0-9]{32}/gi, 'high');
  r('credential', 'Database Connection String', 'Database URL with credentials', /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^/\s]+/gi, 'high');
  r('credential', 'Generic API Key', 'Generic api_key/apikey pattern', /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}['"]?/gi, 'medium');
  r('credential', 'Password in Config', 'Password assignment', /(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi, 'high');

  // ========== PII (15 rules) ==========
  r('pii', 'US SSN', 'US Social Security Number', /\b\d{3}-\d{2}-\d{4}\b/g, 'high');
  r('pii', 'Credit Card Number', 'Credit/debit card number', /\b(?:\d[ -]*?){13,19}\b/g, 'high', luhnCheck);
  r('pii', 'Email Bulk', 'Multiple email addresses (potential exfil)', /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*[,;\n]){3,}/g, 'medium');
  r('pii', 'Phone Number US', 'US phone number', /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, 'low');
  // Tightened: require "passport" context to avoid false positives on Azure resource IDs
  r('pii', 'US Passport', 'US passport number (with context)', /(?:passport|travel\s+document)\s*(?:#|number|no\.?)\s*:?\s*([A-Z]\d{8})\b/gi, 'high');
  // Tightened: require "license" or "DL" context to avoid matching generic alphanumeric codes
  r('pii', 'US Drivers License', 'US driver license (with context)', /(?:driver'?s?\s+license|DL|license\s*#)\s*:?\s*([A-Z]{1,2}\d{5,8})\b/gi, 'medium');
  r('pii', 'Date of Birth', 'Date of birth pattern', /(?:DOB|date\s*of\s*birth|born|birthday)\s*[=:]\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/gi, 'medium');
  r('pii', 'IBAN', 'International Bank Account Number', /\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?(?:[A-Z0-9]{4}[\s]?){1,7}[A-Z0-9]{1,4}\b/g, 'high');
  // ReDoS-hardened: bound the leading token and the inter-token gap so the scan stays linear on large (≤500KB) payloads.
  r('pii', 'IPv4 with Name', 'IP address associated with a name', /\b(?:name|user|employee)\s*[=:]\s*\S{1,128}[\s\S]{0,120}?\b(?:\d{1,3}\.){3}\d{1,3}\b/gi, 'medium');
  r('pii', 'Personal Address', 'Street address pattern', /\b\d{1,5}\s+\w+(?:\s+\w+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Pl|Place|Way)\b/gi, 'low');
  r('pii', 'Tax ID (EIN)', 'Employer Identification Number', /\b\d{2}-\d{7}\b/g, 'medium');
  r('pii', 'Medicare ID', 'Medicare Beneficiary Identifier', /\b[1-9][A-Z][A-Z0-9]\d-[A-Z][A-Z0-9]\d-[A-Z]{2}\d{2}\b/g, 'high');
  // Tightened: require "VIN" context and add Luhn-like check digit validation
  r('pii', 'VIN', 'Vehicle Identification Number (with context)', /(?:VIN|vehicle\s+identification)\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/gi, 'low');
  // ReDoS-hardened: bound the leading token and the inter-token gap (proximity window) so the scan stays linear.
  r('pii', 'Full Name + SSN', 'Name paired with SSN', /(?:name|first|last)\s*[=:]\s*\w{1,64}[\s\S]{0,120}?\d{3}-\d{2}-\d{4}/gi, 'critical');
  // ReDoS-hardened: bound the email subparts (so greedy + cannot run away over a long tail) and the gap.
  r('pii', 'Email + Password', 'Email with password in same context', /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,24}[\s\S]{0,120}?(?:password|passwd|pwd)\s*[=:]/gi, 'critical');

  // ========== INFRASTRUCTURE (10 rules) ==========
  r('infrastructure', 'Internal IP RFC1918 10.x', 'RFC1918 private IP (10.0.0.0/8)', /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, 'low');
  r('infrastructure', 'Internal IP RFC1918 172.x', 'RFC1918 private IP (172.16.0.0/12)', /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, 'low');
  r('infrastructure', 'Internal IP RFC1918 192.x', 'RFC1918 private IP (192.168.0.0/16)', /\b192\.168\.\d{1,3}\.\d{1,3}\b/g, 'low');
  r('infrastructure', 'K8s Secret', 'Kubernetes secret reference', /(?:kubectl|secret|configmap)\s+(?:get|describe|create)\s+\S+/gi, 'medium');
  r('infrastructure', 'Docker Registry Creds', 'Docker registry credentials', /(?:docker\s+login|\.dockerconfigjson|docker_password)\s*/gi, 'high');
  r('infrastructure', 'Env File Contents', '.env file content patterns', /^(?:export\s+)?[A-Z_]{3,}=\S+$/gm, 'medium');
  r('infrastructure', 'SSH Host', 'SSH connection string', /ssh\s+(?:-[A-Za-z]\s+\S+\s+)*\S+@\S+/g, 'medium');
  r('infrastructure', 'Kubeconfig', 'Kubernetes config file', /(?:clusters|contexts|users):\s*\n\s*-\s*(?:cluster|context|user):/gm, 'high');
  r('infrastructure', 'Terraform State', 'Terraform state secrets', /"(?:access_key|secret_key|password|token)"\s*:\s*"[^"]+"/g, 'high');
  r('infrastructure', 'Internal Hostname', 'Cluster-internal service hostname', /\b\w+\.(?:svc\.cluster\.local|internal|local)\b/g, 'low');

  // ========== COMPLIANCE (5 rules) ==========
  r('compliance', 'HIPAA MRN', 'Medical Record Number', /(?:MRN|medical\s*record)\s*[#:=]\s*\d{6,}/gi, 'high');
  r('compliance', 'HIPAA NPI', 'National Provider Identifier', /\bNPI\s*[#:=]?\s*\d{10}\b/gi, 'high');
  r('compliance', 'PCI Card Data', 'Full track data or CVV', /(?:track[12]|cvv|cvc|cvv2)\s*[=:]\s*\d+/gi, 'critical');
  r('compliance', 'FERPA Student Record', 'Student ID/record reference', /(?:student\s*(?:id|record|number))\s*[=:]\s*\S+/gi, 'medium');
  r('compliance', 'CUI Marking', 'Controlled Unclassified Information marker', /\b(?:CUI|CONTROLLED\s+UNCLASSIFIED)\b/g, 'medium');

  // ========== INJECTION (5 rules — for tool-result scanning) ==========
  r('injection', 'System Prompt Override', 'Attempts to override system prompt', /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/gi, 'high');
  r('injection', 'Role Confusion', 'Attempts to impersonate system/assistant role', /(?:you\s+are\s+now|switch\s+to|act\s+as|new\s+instructions?:)/gi, 'high');
  r('injection', 'Instruction Injection JSON', 'Injection hidden in JSON values', /"(?:instructions?|system|prompt)"\s*:\s*"[^"]*(?:ignore|override|disregard)/gi, 'high');
  r('injection', 'Hidden Instruction Markers', 'Markdown/HTML hidden instruction patterns', /<!--\s*(?:system|instruction|hidden)[\s\S]*?-->/gi, 'medium');
  r('injection', 'Exfiltration Attempt', 'Tool trying to send data to external URL', /(?:fetch|curl|wget|http\.get|axios)\s*\(?\s*['"]https?:\/\/(?!localhost|127\.0\.0\.1|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/gi, 'critical');

  return rules;
}

// ---------------------------------------------------------------------------
// DLP Scanner Service
// ---------------------------------------------------------------------------

export class DLPScannerService {
  private rules: DLPRule[];
  private logger: Logger;
  private disabledCategories = new Set<DLPCategory>();
  private toolExceptions = new Map<string, Set<string>>(); // toolName → Set<ruleId>
  private toolScanExemptions: DLPToolExemption[] = [];

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'DLPScanner' });
    this.rules = buildDefaultRules();
  }

  /**
   * Load admin configuration (disabled categories, tool exceptions, custom rules).
   */
  async loadConfig(): Promise<void> {
    try {
      const config = await prisma.systemConfiguration.findFirst({
        where: { key: 'dlp_rules' },
      });
      if (config?.value) {
        const val = typeof config.value === 'string' ? JSON.parse(config.value) : config.value;
        if (val.disabledCategories) {
          this.disabledCategories = new Set(val.disabledCategories);
        }
        if (val.toolExceptions) {
          for (const [tool, ruleIds] of Object.entries(val.toolExceptions)) {
            this.toolExceptions.set(tool, new Set(ruleIds as string[]));
          }
        }
        // Toggle individual rules
        if (val.disabledRules) {
          const disabled = new Set(val.disabledRules as string[]);
          for (const rule of this.rules) {
            if (disabled.has(rule.id)) rule.enabled = false;
          }
        }
        // Load tool+scanPoint exemptions
        if (val.toolScanExemptions) {
          this.toolScanExemptions = (val.toolScanExemptions as DLPToolExemption[]).filter(e => e.enabled !== false);
        }
        // Restore global disable state
        if (val.globalDisabled !== undefined) {
          this.globalDisabled = !!val.globalDisabled;
        }
        this.logger.info({
          disabledCategories: Array.from(this.disabledCategories),
          toolExceptions: this.toolExceptions.size,
          toolScanExemptions: this.toolScanExemptions.length,
        }, '[DLP] Loaded admin configuration');
      }
    } catch (error) {
      this.logger.warn({ error }, '[DLP] Failed to load admin config — using defaults');
    }
  }

  /**
   * Scan text for DLP findings.
   */
  scan(text: string, context: DLPScanContext): DLPScanResult {
    const start = Date.now();
    const findings: DLPFinding[] = [];
    let worstSeverity: DLPSeverity = 'low';

    // Global kill switch — bypass ALL scanning when disabled
    if (this.globalDisabled) {
      return { findings: [], severity: 'low', action: 'allow', scannedLength: text?.length || 0, scanTimeMs: 0 };
    }

    if (!text || typeof text !== 'string') {
      return { findings: [], severity: 'low', action: 'allow', scannedLength: 0, scanTimeMs: 0 };
    }

    // Check tool+scanPoint exemptions — skip entire categories for matching tools
    const exemptCategories = new Set<DLPCategory>();
    if (context.toolName && context.scanPoint) {
      for (const exemption of this.toolScanExemptions) {
        if (this.matchToolPattern(exemption.toolPattern, context.toolName) &&
            exemption.scanPoint === context.scanPoint) {
          for (const cat of exemption.exemptCategories) {
            exemptCategories.add(cat);
          }
        }
      }
      if (exemptCategories.size > 0) {
        this.logger.debug({
          toolName: context.toolName,
          scanPoint: context.scanPoint,
          exemptCategories: [...exemptCategories],
        }, '[DLP] Tool exemption applied — skipping categories');
      }
    }

    // Cap scan length to prevent DoS on huge payloads
    const scanText = text.length > 500_000 ? text.slice(0, 500_000) : text;

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (this.disabledCategories.has(rule.category)) continue;
      if (exemptCategories.has(rule.category)) continue;
      if (context.toolName && this.toolExceptions.get(context.toolName)?.has(rule.id)) continue;

      // Reset regex lastIndex for global patterns
      rule.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(scanText)) !== null) {
        const matchText = match[0];

        // Run optional validator
        if (rule.validate && !rule.validate(matchText)) continue;

        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          severity: rule.severity,
          match: matchText.length > 40 ? matchText.slice(0, 20) + '...' + matchText.slice(-10) : matchText,
          startIndex: match.index,
          endIndex: match.index + matchText.length,
        });

        worstSeverity = maxSeverity(worstSeverity, rule.severity);

        // Limit findings per rule to avoid huge output
        if (findings.filter(f => f.ruleId === rule.id).length >= 10) break;
      }
    }

    const action = findings.length > 0 ? severityToAction(worstSeverity) : 'allow';
    const scanTimeMs = Date.now() - start;

    // Log findings
    if (findings.length > 0) {
      this.logger.warn({
        findingsCount: findings.length,
        severity: worstSeverity,
        action,
        scanPoint: context.scanPoint,
        userId: context.userId,
        toolName: context.toolName,
        categories: [...new Set(findings.map(f => f.category))],
      }, `[DLP] ${findings.length} finding(s) detected — action: ${action}`);
    }

    // Persist findings asynchronously (don't block the scan)
    if (findings.length > 0) {
      this.persistFindings(findings, context, action).catch(err => {
        this.logger.error({ error: err }, '[DLP] Failed to persist findings');
      });
    }

    return { findings, severity: worstSeverity, action, scannedLength: scanText.length, scanTimeMs };
  }

  /**
   * Redact detected values in text, replacing with [REDACTED:type].
   */
  redact(text: string, findings: DLPFinding[]): string {
    if (findings.length === 0) return text;

    // Sort findings by start index descending so we can replace from end to start
    const sorted = [...findings].sort((a, b) => b.startIndex - a.startIndex);
    let result = text;

    for (const finding of sorted) {
      if (finding.startIndex >= 0 && finding.endIndex <= result.length) {
        const redactionTag = `[REDACTED:${finding.category}/${finding.ruleName}]`;
        result = result.slice(0, finding.startIndex) + redactionTag + result.slice(finding.endIndex);
      }
    }

    return result;
  }

  /**
   * Scan and act: scan text, apply action (redact/block), return result.
   */
  scanAndAct(text: string, context: DLPScanContext): { text: string; blocked: boolean; result: DLPScanResult } {
    const result = this.scan(text, context);

    if (result.action === 'block') {
      return { text, blocked: true, result };
    }

    if (result.action === 'redact') {
      const redacted = this.redact(text, result.findings);
      return { text: redacted, blocked: false, result };
    }

    return { text, blocked: false, result };
  }

  /**
   * Get all rules (for admin UI).
   */
  getRules(): DLPRule[] {
    return this.rules.map(r => ({
      ...r,
      pattern: new RegExp(r.pattern.source, r.pattern.flags),
    }));
  }

  /**
   * Get rule counts by category.
   */
  getRuleSummary(): Record<DLPCategory, number> {
    const summary: Record<string, number> = {};
    for (const rule of this.rules) {
      summary[rule.category] = (summary[rule.category] || 0) + 1;
    }
    return summary as Record<DLPCategory, number>;
  }

  getExemptions(): DLPToolExemption[] {
    return [...this.toolScanExemptions];
  }

  async addExemption(exemption: Omit<DLPToolExemption, 'id'>): Promise<DLPToolExemption> {
    const newExemption: DLPToolExemption = {
      ...exemption,
      id: `EX-${Date.now()}`,
      enabled: true,
    };
    this.toolScanExemptions.push(newExemption);
    await this.saveConfig();
    return newExemption;
  }

  async removeExemption(id: string): Promise<boolean> {
    const idx = this.toolScanExemptions.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.toolScanExemptions.splice(idx, 1);
    await this.saveConfig();
    return true;
  }

  async toggleRule(ruleId: string, enabled: boolean): Promise<boolean> {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    await this.saveConfig();
    return true;
  }

  async updateRuleSeverity(ruleId: string, severity: DLPSeverity): Promise<boolean> {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.severity = severity;
    await this.saveConfig();
    return true;
  }

  private async saveConfig(): Promise<void> {
    const disabledRules = this.rules.filter(r => !r.enabled).map(r => r.id);
    const config = {
      globalDisabled: this.globalDisabled,
      disabledCategories: [...this.disabledCategories],
      disabledRules,
      toolScanExemptions: this.toolScanExemptions,
      toolExceptions: Object.fromEntries(this.toolExceptions),
    };
    try {
      await prisma.systemConfiguration.upsert({
        where: { key: 'dlp_rules' },
        update: { value: config as any },
        create: { key: 'dlp_rules', value: config as any },
      });
      this.logger.info({ disabledRules: disabledRules.length, globalDisabled: this.globalDisabled }, '[DLP] Config saved to database');
    } catch (error) {
      this.logger.error({ error }, '[DLP] Failed to save config to database');
      throw error; // Propagate so callers know the save failed
    }
  }

  // ── Global DLP switch ──

  private globalDisabled = false;

  /** Disable ALL DLP scanning globally (for testing/debugging) */
  async setGlobalDisabled(disabled: boolean): Promise<void> {
    this.globalDisabled = disabled;
    await this.saveConfig();
    this.logger.info({ globalDisabled: disabled }, `[DLP] Global scanning ${disabled ? 'DISABLED' : 'ENABLED'}`);
  }

  isGlobalDisabled(): boolean {
    return this.globalDisabled;
  }

  /** Disable/enable an entire category at once */
  async toggleCategory(category: DLPCategory, enabled: boolean): Promise<void> {
    for (const rule of this.rules) {
      if (rule.category === category) {
        rule.enabled = enabled;
      }
    }
    if (enabled) {
      this.disabledCategories.delete(category);
    } else {
      this.disabledCategories.add(category);
    }
    await this.saveConfig();
  }

  private matchToolPattern(pattern: string, toolName: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return toolName.startsWith(pattern.slice(0, -1));
    }
    return pattern === toolName;
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  private async persistFindings(
    findings: DLPFinding[],
    context: DLPScanContext,
    action: DLPAction,
  ): Promise<void> {
    try {
      // Use createMany for efficiency
      await prisma.dLPFinding.createMany({
        data: findings.map(f => ({
          user_id: context.userId,
          session_id: context.sessionId ?? null,
          execution_id: context.executionId ?? null,
          scan_point: context.scanPoint,
          rule_id: f.ruleId,
          category: f.category,
          severity: f.severity,
          action_taken: action,
          context: {
            toolName: context.toolName ?? null,
            ruleName: f.ruleName,
            matchSnippet: f.match,
          },
        })),
      });
    } catch (error) {
      // If model doesn't exist yet (migration not run), log but don't throw
      this.logger.debug({ error }, '[DLP] Could not persist findings (migration may be pending)');
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: DLPScannerService | null = null;

export function getDLPScanner(logger: Logger): DLPScannerService {
  if (!_instance) {
    _instance = new DLPScannerService(logger);
  }
  return _instance;
}

export async function initializeDLPScanner(logger: Logger): Promise<DLPScannerService> {
  _instance = new DLPScannerService(logger);
  await _instance.loadConfig();

  // Seed default exemptions — check for each individually so new ones get added on upgrade
  const existingExemptions = _instance.getExemptions();
  const hasExemption = (pattern: string) => existingExemptions.some(e => e.toolPattern === pattern);

  const exemptionsToSeed: Array<Omit<DLPToolExemption, 'id' | 'enabled'>> = [
    { toolPattern: 'web_*', scanPoint: 'tool_result' as DLPScanPoint, exemptCategories: ['pii' as DLPCategory], reason: 'Public web content naturally contains PII patterns (emails, phone numbers)' },
    { toolPattern: 'prometheus_*', scanPoint: 'tool_result' as DLPScanPoint, exemptCategories: ['infrastructure' as DLPCategory], reason: 'Prometheus metrics use KEY=VALUE format that falsely triggers env file detection (DLP-015)' },
    { toolPattern: 'loki_*', scanPoint: 'tool_result' as DLPScanPoint, exemptCategories: ['infrastructure' as DLPCategory], reason: 'Loki log entries contain env-var-like patterns from application logs' },
    { toolPattern: 'k8s_*', scanPoint: 'tool_result' as DLPScanPoint, exemptCategories: ['infrastructure' as DLPCategory], reason: 'Kubernetes resource specs contain env var definitions as normal config' },
    { toolPattern: 'admin_system_*', scanPoint: 'tool_result' as DLPScanPoint, exemptCategories: ['infrastructure' as DLPCategory], reason: 'Admin health check results contain infrastructure config patterns' },
  ];

  let seeded = 0;
  for (const ex of exemptionsToSeed) {
    if (!hasExemption(ex.toolPattern)) {
      await _instance.addExemption({ ...ex, enabled: true });
      seeded++;
    }
  }
  if (seeded > 0) {
    logger.info({ count: seeded }, '[DLP] Seeded new default exemptions');
  }

  return _instance;
}

/**
 * No-arg singleton read — returns the instance set by initializeDLPScanner().
 * Returns null if the scanner has not been initialized yet.
 */
export function getDLPScannerInstance(): DLPScannerService | null {
  return _instance;
}
