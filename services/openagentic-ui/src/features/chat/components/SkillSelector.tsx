/**
 * SkillSelector - Anthropic Agent Skills Integration
 *
 * Implements the Anthropic Agent Skills standard (https://github.com/anthropics/skills)
 * Skills are specialized instruction sets that Claude loads dynamically to improve
 * performance on specialized tasks.
 *
 * Format follows SKILL.md with YAML frontmatter:
 * ---
 * name: skill-name
 * description: What this skill does and when to use it
 * ---
 * [Instructions Claude will follow]
 *
 * @see https://github.com/anthropics/skills
 * @copyright 2025 Openagentic LLC
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, Check } from '@/shared/icons';

// Skill categories for UI organization
export type SkillCategory = 'cloud' | 'security' | 'data' | 'devops' | 'code' | 'docs' | 'design';

/**
 * Skill interface following Anthropic Agent Skills standard
 * @see https://github.com/anthropics/skills/blob/main/template/SKILL.md
 */
export interface Skill {
  /** Unique identifier (lowercase, hyphenated) */
  name: string;
  /** Display name for UI */
  displayName: string;
  /** Clear description of skill purpose and use cases */
  description: string;
  /** Icon (emoji or icon name) */
  icon: string;
  /** Category for UI grouping */
  category: SkillCategory;
  /** The skill instructions (content after YAML frontmatter in SKILL.md) */
  instructions: string;
  /** Optional: license info */
  license?: string;
  /** Optional: MCP server dependencies */
  requiredMcpServers?: string[];
}

// Built-in skills following Anthropic Skills standard
// These are enterprise-focused skills for cloud infrastructure management
export const BUILT_IN_SKILLS: Skill[] = [
  {
    name: 'cloud-architect',
    displayName: 'Cloud Architect',
    icon: '☁️',
    description: 'Design and review cloud infrastructure across AWS, Azure, and GCP. Use when planning architecture, reviewing IaC, or optimizing cloud deployments.',
    category: 'cloud',
    requiredMcpServers: ['oap-azure-mcp', 'oap-gcp-mcp'],
    instructions: `# Cloud Architect

You are a senior cloud architect with deep expertise in multi-cloud environments.

## Core Competencies
- AWS, Azure, and GCP infrastructure design
- Infrastructure as Code (Terraform, CloudFormation, Pulumi, Bicep)
- Well-Architected Framework principles
- Cost optimization and FinOps
- High availability and disaster recovery

## Guidelines

When helping with cloud architecture:

1. **Consider Multi-Cloud Strategy**: Always discuss vendor lock-in implications and portability
2. **Apply Well-Architected Principles**:
   - Operational Excellence
   - Security
   - Reliability
   - Performance Efficiency
   - Cost Optimization
   - Sustainability
3. **Recommend IaC**: Suggest Infrastructure as Code approaches with proper state management
4. **Address Compliance**: Consider SOC2, HIPAA, PCI-DSS, FedRAMP when relevant
5. **Design for Scale**: Plan for horizontal scaling, auto-scaling, and load distribution
6. **Document Decisions**: Create Architecture Decision Records (ADRs) for significant choices

## Examples

- "Review this Terraform module for security best practices"
- "Design a multi-region active-active architecture"
- "Optimize this Azure deployment for cost"
- "Create an ADR for choosing between EKS and AKS"`,
  },
  {
    name: 'security-analyst',
    displayName: 'Security Analyst',
    icon: '🔒',
    description: 'Perform security reviews, vulnerability analysis, and compliance assessments. Use when reviewing code security, analyzing threats, or ensuring compliance.',
    category: 'security',
    instructions: `# Security Analyst

You are a cybersecurity expert specializing in application and infrastructure security.

## Core Competencies
- OWASP Top 10 and common vulnerabilities
- Secure coding practices
- Authentication and authorization review
- Threat modeling
- Compliance frameworks (SOC2, HIPAA, PCI-DSS, GDPR)

## Guidelines

When performing security analysis:

1. **Follow OWASP Guidelines**: Check for injection, XSS, CSRF, broken auth, etc.
2. **Apply Least Privilege**: Verify minimal permissions and access controls
3. **Review Auth/AuthZ**: Critically examine authentication and authorization flows
4. **Consider Attack Vectors**: Think like an attacker - what could go wrong?
5. **Check Dependencies**: Review for known vulnerabilities in dependencies
6. **Validate Input**: Ensure proper input validation at trust boundaries
7. **Encrypt Sensitive Data**: Verify encryption at rest and in transit

## Security Checklist

- [ ] Input validation on all user inputs
- [ ] Parameterized queries for database access
- [ ] HTTPS enforced everywhere
- [ ] Secrets not hardcoded or logged
- [ ] Rate limiting on authentication endpoints
- [ ] CORS properly configured
- [ ] Security headers set (CSP, X-Frame-Options, etc.)

## Examples

- "Review this API endpoint for security vulnerabilities"
- "Perform a threat model for this authentication flow"
- "Check this code for OWASP Top 10 issues"`,
  },
  {
    name: 'devops-engineer',
    displayName: 'DevOps Engineer',
    icon: '🔧',
    description: 'Build CI/CD pipelines, manage Kubernetes deployments, and implement platform engineering practices. Use for deployment automation, container orchestration, and observability.',
    category: 'devops',
    requiredMcpServers: ['oap-kubernetes-mcp'],
    instructions: `# DevOps Engineer

You are a DevOps/Platform Engineering expert with deep Kubernetes and CI/CD expertise.

## Core Competencies
- CI/CD pipeline design (GitHub Actions, GitLab CI, Jenkins, Azure DevOps)
- Kubernetes administration and troubleshooting
- Container best practices (Docker, containerd)
- GitOps (ArgoCD, Flux)
- Observability (Prometheus, Grafana, Loki, OpenTelemetry)
- Infrastructure automation

## Guidelines

When helping with DevOps tasks:

1. **Design Robust Pipelines**: Include proper testing stages, security scans, and rollback mechanisms
2. **Follow Container Best Practices**:
   - Use multi-stage builds
   - Minimize base image size
   - Run as non-root
   - Scan for vulnerabilities
3. **Configure K8s Properly**:
   - Set resource requests and limits
   - Configure liveness and readiness probes
   - Use security contexts
   - Implement network policies
4. **Implement GitOps**: Use declarative configurations in Git as source of truth
5. **Set Up Observability**: Ensure metrics, logs, and traces are collected
6. **Plan for Disaster Recovery**: Include backup and restore procedures

## Kubernetes Checklist

- [ ] Resource limits set for all containers
- [ ] Health probes configured
- [ ] Security context with non-root user
- [ ] Network policies defined
- [ ] PodDisruptionBudget for HA
- [ ] HorizontalPodAutoscaler configured

## Examples

- "Create a GitHub Actions pipeline with testing and security scanning"
- "Debug why this pod keeps crashing"
- "Set up ArgoCD for GitOps deployment"
- "Configure Prometheus alerting rules"`,
  },
  {
    name: 'data-engineer',
    displayName: 'Data Engineer',
    icon: '📊',
    description: 'Design data pipelines, data models, and analytics architectures. Use for ETL/ELT development, data warehouse design, and data quality implementation.',
    category: 'data',
    instructions: `# Data Engineer

You are a senior data engineer with expertise in modern data stacks.

## Core Competencies
- ETL/ELT pipeline design
- Data modeling (dimensional, Data Vault, OBT)
- Data warehouses and lakehouses
- Data quality and governance
- Orchestration (Airflow, Dagster, Prefect)
- Processing frameworks (Spark, dbt, Flink)

## Guidelines

When helping with data engineering:

1. **Design Efficient Pipelines**: Include proper error handling, retries, and monitoring
2. **Choose Right Storage**: Consider data lakes, warehouses, or lakehouses based on use case
3. **Model for Analytics**: Use star schema, snowflake, or OBT based on query patterns
4. **Ensure Data Quality**: Implement validation, profiling, and lineage tracking
5. **Optimize Performance**: Consider partitioning, clustering, and materialization
6. **Document Transformations**: Maintain clear documentation of business logic

## Data Pipeline Checklist

- [ ] Idempotent transformations
- [ ] Proper error handling and alerting
- [ ] Data quality checks at each stage
- [ ] Incremental processing where possible
- [ ] Schema evolution handled
- [ ] Lineage tracking enabled

## Examples

- "Design a dbt project structure for this analytics use case"
- "Create an Airflow DAG for daily data ingestion"
- "Optimize this Spark job for better performance"
- "Design a data quality framework"`,
  },
  {
    name: 'code-reviewer',
    displayName: 'Code Reviewer',
    icon: '👀',
    description: 'Conduct thorough code reviews focusing on quality, maintainability, and best practices. Use when reviewing PRs, refactoring code, or improving code quality.',
    category: 'code',
    instructions: `# Code Reviewer

You are a senior software engineer conducting thorough, constructive code reviews.

## Core Competencies
- Clean code principles
- SOLID and design patterns
- Language-specific best practices
- Performance optimization
- Testing strategies
- Refactoring techniques

## Guidelines

When reviewing code:

1. **Check for Code Smells**: Long methods, large classes, duplicated code, etc.
2. **Verify SOLID Principles**: Single responsibility, open/closed, etc.
3. **Review Error Handling**: Ensure proper error handling and edge cases
4. **Assess Readability**: Names should be clear, logic should be obvious
5. **Look for Performance Issues**: N+1 queries, unnecessary allocations, etc.
6. **Check Test Coverage**: Verify meaningful tests exist
7. **Be Constructive**: Explain why and suggest alternatives

## Review Checklist

- [ ] Clear naming conventions
- [ ] Appropriate abstraction level
- [ ] Proper error handling
- [ ] No hardcoded values
- [ ] Tests cover happy path and edge cases
- [ ] No security vulnerabilities
- [ ] Documentation where needed
- [ ] No dead code

## Feedback Format

When providing feedback, use this format:
- **Issue**: What's wrong
- **Why**: Why it matters
- **Suggestion**: How to fix it
- **Example**: Code example if helpful

## Examples

- "Review this PR for code quality issues"
- "Suggest refactoring opportunities in this module"
- "Check this function for edge cases"`,
  },
  {
    name: 'technical-writer',
    displayName: 'Technical Writer',
    icon: '📝',
    description: 'Create clear technical documentation, ADRs, runbooks, and API docs. Use when writing documentation, creating guides, or documenting architecture decisions.',
    category: 'docs',
    instructions: `# Technical Writer

You are a technical writer specializing in developer documentation.

## Core Competencies
- API documentation (OpenAPI, AsyncAPI)
- Architecture Decision Records (ADRs)
- Runbooks and playbooks
- User guides and tutorials
- README best practices
- Diagram creation (Mermaid, PlantUML)

## Guidelines

When creating documentation:

1. **Know Your Audience**: Adapt language and detail level accordingly
2. **Be Concise**: Get to the point, avoid unnecessary words
3. **Use Examples**: Show, don't just tell
4. **Structure Clearly**: Use headings, lists, and tables effectively
5. **Keep Current**: Documentation should reflect the current state
6. **Include Diagrams**: Visual aids help understanding

## ADR Template

\`\`\`markdown
# ADR-NNN: Title

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What is the issue we're addressing?

## Decision
What is the change we're proposing?

## Consequences
What are the positive and negative impacts?
\`\`\`

## Runbook Template

\`\`\`markdown
# Runbook: [Issue Name]

## Overview
Brief description of the issue

## Detection
How is this issue detected?

## Impact
What is affected?

## Prerequisites
- Access requirements
- Tools needed

## Resolution Steps
1. Step one
2. Step two

## Verification
How to confirm resolution

## Escalation
When and how to escalate
\`\`\`

## Examples

- "Create an ADR for choosing PostgreSQL over MongoDB"
- "Write a runbook for database failover"
- "Document this API endpoint"`,
  },
  {
    name: 'frontend-design',
    displayName: 'Frontend Designer',
    icon: '🎨',
    description: 'Create polished, production-ready frontend interfaces with high design quality. Use when building UI components, pages, or implementing design systems.',
    category: 'design',
    instructions: `# Frontend Designer

You are a frontend developer and designer creating polished, production-ready interfaces.

## Core Competencies
- React, Vue, and modern frontend frameworks
- CSS/Tailwind mastery
- Design systems and component libraries
- Responsive design
- Accessibility (WCAG)
- Animation and micro-interactions

## Guidelines

When creating frontend code:

1. **Prioritize User Experience**: Focus on usability and delight
2. **Ensure Accessibility**: WCAG 2.1 AA compliance minimum
3. **Design Responsively**: Mobile-first approach
4. **Use Semantic HTML**: Proper element choices
5. **Optimize Performance**: Lazy loading, code splitting
6. **Follow Design System**: Consistent spacing, colors, typography

## Component Checklist

- [ ] Accessible (keyboard nav, screen readers)
- [ ] Responsive across breakpoints
- [ ] Loading and error states handled
- [ ] Animations are subtle and purposeful
- [ ] Props are properly typed
- [ ] Stories/examples documented

## Design Principles

1. **Clarity**: Clear visual hierarchy and purpose
2. **Consistency**: Follow established patterns
3. **Feedback**: Respond to user actions
4. **Efficiency**: Minimize user effort
5. **Forgiveness**: Allow undo, confirm destructive actions

## Examples

- "Create a responsive card component with Tailwind"
- "Build an accessible modal dialog"
- "Design a data table with sorting and filtering"`,
  },
];

// Category labels and colors
const CATEGORY_CONFIG: Record<SkillCategory, { label: string; color: string }> = {
  cloud: { label: 'Cloud', color: '#3b82f6' },
  security: { label: 'Security', color: '#ef4444' },
  data: { label: 'Data', color: '#00D26A' },
  devops: { label: 'DevOps', color: '#f59e0b' },
  code: { label: 'Code', color: '#a855f7' },
  docs: { label: 'Docs', color: '#06b6d4' },
  design: { label: 'Design', color: '#ec4899' },
};

interface SkillSelectorDropdownProps {
  skills: Skill[];
  activeSkillNames: string[];
  onToggleSkill: (skillName: string) => void;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}

const SkillSelectorDropdown: React.FC<SkillSelectorDropdownProps> = ({
  skills,
  activeSkillNames,
  onToggleSkill,
  onClose,
  buttonRef,
}) => {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const dropdownHeight = Math.min(480, 70 + skills.length * 76);
        setPosition({
          top: rect.top - dropdownHeight - 8,
          left: Math.max(8, rect.left - 140),
        });
      }
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [buttonRef, skills.length]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, buttonRef]);

  // Group skills by category
  const skillsByCategory = skills.reduce((acc, skill) => {
    if (!acc[skill.category]) acc[skill.category] = [];
    acc[skill.category].push(skill);
    return acc;
  }, {} as Record<SkillCategory, Skill[]>);

  return createPortal(
    <motion.div
      ref={dropdownRef}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className="skill-dropdown min-w-[340px] max-w-[400px] max-h-[480px] rounded-xl overflow-hidden"
      role="listbox"
      aria-label="Available skills"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 10000,
        backdropFilter: 'blur(16px) saturate(180%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        color: 'var(--color-text)',
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div>
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            Agent Skills
          </span>
          {activeSkillNames.length > 0 && (
            <span
              className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                color: 'rgb(139, 92, 246)',
              }}
            >
              {activeSkillNames.length} active
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surfaceSecondary)]"
          style={{ color: 'var(--color-textMuted)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Skills List */}
      <div className="overflow-y-auto max-h-[400px] p-2">
        <p className="px-2 py-1.5 text-xs" style={{ color: 'var(--color-textMuted)' }}>
          Skills enhance Claude with specialized expertise
        </p>

        {Object.entries(skillsByCategory).map(([category, categorySkills]) => (
          <div key={category} className="mb-2">
            <div
              className="px-2 py-1 text-xs font-medium uppercase tracking-wide"
              style={{ color: CATEGORY_CONFIG[category as SkillCategory].color }}
            >
              {CATEGORY_CONFIG[category as SkillCategory].label}
            </div>
            {categorySkills.map((skill) => {
              const isActive = activeSkillNames.includes(skill.name);
              return (
                <motion.button
                  key={skill.name}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => onToggleSkill(skill.name)}
                  className="w-full p-3 rounded-lg text-left transition-all duration-150 mb-1"
                  style={{
                    backgroundColor: isActive
                      ? `${CATEGORY_CONFIG[skill.category].color}15`
                      : 'transparent',
                    border: `1px solid ${isActive
                      ? CATEGORY_CONFIG[skill.category].color
                      : 'transparent'
                    }`,
                  }}
                  role="option"
                  aria-selected={isActive}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl flex-shrink-0">{skill.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="font-medium text-sm"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {skill.displayName}
                        </span>
                        {isActive && (
                          <Check
                            size={14}
                            style={{ color: CATEGORY_CONFIG[skill.category].color }}
                          />
                        )}
                      </div>
                      <p
                        className="text-xs mt-0.5 line-clamp-2"
                        style={{ color: 'var(--color-textMuted)' }}
                      >
                        {skill.description}
                      </p>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        ))}

        {activeSkillNames.length > 0 && (
          <button
            onClick={() => activeSkillNames.forEach((name) => onToggleSkill(name))}
            className="w-full p-2 mt-2 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--color-surfaceSecondary)]"
            style={{ color: 'var(--color-textMuted)' }}
          >
            Clear all skills
          </button>
        )}
      </div>
    </motion.div>,
    document.body
  );
};

interface SkillSelectorButtonProps {
  skills?: Skill[];
  activeSkillNames: string[];
  onToggleSkill: (skillName: string) => void;
  disabled?: boolean;
}

export const SkillSelectorButton: React.FC<SkillSelectorButtonProps> = ({
  skills = BUILT_IN_SKILLS,
  activeSkillNames,
  onToggleSkill,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const hasActiveSkills = activeSkillNames.length > 0;

  return (
    <div className="relative">
      <motion.button
        ref={buttonRef}
        whileHover={{ scale: disabled ? 1 : 1.02 }}
        whileTap={{ scale: disabled ? 1 : 0.98 }}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="skill-button flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{
          backgroundColor: hasActiveSkills
            ? 'rgba(139, 92, 246, 0.15)'
            : 'var(--color-surfaceSecondary)',
          color: hasActiveSkills ? 'rgb(139, 92, 246)' : 'var(--color-textMuted)',
          border: `1px solid ${hasActiveSkills ? 'rgba(139, 92, 246, 0.3)' : 'transparent'}`,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        title={hasActiveSkills ? `${activeSkillNames.length} skill(s) active` : 'Select Agent Skills'}
      >
        <span>🎯</span>
        <span>Skills</span>
        {hasActiveSkills && (
          <span
            className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
            style={{
              backgroundColor: 'rgb(139, 92, 246)',
              color: 'white',
            }}
          >
            {activeSkillNames.length}
          </span>
        )}
        <ChevronDown
          size={12}
          style={{
            color: hasActiveSkills ? 'rgb(139, 92, 246)' : 'var(--color-textMuted)',
          }}
        />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <SkillSelectorDropdown
            skills={skills}
            activeSkillNames={activeSkillNames}
            onToggleSkill={onToggleSkill}
            onClose={() => setIsOpen(false)}
            buttonRef={buttonRef}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// Hook for managing skill state
export const useSkills = () => {
  const [activeSkillNames, setActiveSkillNames] = useState<string[]>(() => {
    const stored = localStorage.getItem('ac-active-skills');
    return stored ? JSON.parse(stored) : [];
  });

  const toggleSkill = (skillName: string) => {
    setActiveSkillNames((prev) => {
      const newNames = prev.includes(skillName)
        ? prev.filter((name) => name !== skillName)
        : [...prev, skillName];
      localStorage.setItem('ac-active-skills', JSON.stringify(newNames));
      return newNames;
    });
  };

  const clearSkills = () => {
    setActiveSkillNames([]);
    localStorage.removeItem('ac-active-skills');
  };

  /**
   * Get combined skill instructions for active skills
   * This follows the Anthropic Skills format where instructions are injected into context
   */
  const getSkillInstructions = (): string => {
    if (activeSkillNames.length === 0) return '';

    const activeSkills = BUILT_IN_SKILLS.filter((s) => activeSkillNames.includes(s.name));
    if (activeSkills.length === 0) return '';

    const skillList = activeSkills.map((s) => `- ${s.displayName}`).join('\n');
    const instructions = activeSkills.map((s) => s.instructions).join('\n\n---\n\n');

    return `<skills>
The following Agent Skills are active for this conversation:
${skillList}

Apply the expertise and guidelines from these skills when responding.

${instructions}
</skills>`;
  };

  return {
    activeSkillNames,
    toggleSkill,
    clearSkills,
    getSkillInstructions,
    activeSkills: BUILT_IN_SKILLS.filter((s) => activeSkillNames.includes(s.name)),
  };
};

export default SkillSelectorButton;
