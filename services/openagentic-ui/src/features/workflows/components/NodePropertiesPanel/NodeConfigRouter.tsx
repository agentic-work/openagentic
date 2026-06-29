/**
 * NodeConfigRouter — maps the selected node's `type` to its config group.
 * This is the extracted form of the original `renderNodeConfig()` switch; the
 * case→component mapping (incl. the aliases and the schema-driven default) is
 * preserved exactly. Every group receives the same `ctx` prop bundle.
 */

import React from 'react';
import type { Node } from 'reactflow';
import type { NodeData } from '../../types/workflow.types';
import type { NodeConfigContext } from './types';
import {
  TriggerConfig,
  CodeConfig,
  ConditionConfig,
  TransformConfig,
  LoopConfig,
  MergeConfig,
  SwitchConfig,
  ParallelConfig,
  WaitConfig,
  WebhookResponseConfig,
  UserContextConfig,
  TextNoteConfig,
} from './groups/CoreFlowConfig';
import {
  MCPToolConfig,
  LLMConfig,
  OpenagenticLLMConfig,
  BedrockConfig,
  VertexConfig,
  AzureAIConfig,
  ReasoningConfig,
} from './groups/ModelConfig';
import {
  AgentSpawnConfig,
  AgentSingleConfig,
  AgentPoolConfig,
  AgentSupervisorConfig,
  MultiAgentConfig,
  SynthConfig,
} from './groups/AgentConfig';
import {
  HttpRequestConfig,
  ApprovalConfig,
  ErrorHandlerConfig,
  SlackConfig,
  TeamsConfig,
  EmailConfig,
  PagerDutyConfig,
  ServiceNowConfig,
  JiraConfig,
  DiscordConfig,
  RagQueryConfig,
  FileUploadConfig,
} from './groups/IntegrationConfig';
import { SchemaDrivenConfig } from './groups/SchemaDrivenConfig';

export const NodeConfigRouter: React.FC<{ node: Node<NodeData>; ctx: NodeConfigContext }> = ({ node, ctx }) => {
  switch (node.type) {
    case 'trigger':
      return <TriggerConfig {...ctx} />;
    case 'mcp_tool':
      return <MCPToolConfig {...ctx} />;
    case 'llm_completion':
      return <LLMConfig {...ctx} />;
    case 'openagentic_llm':
      return <OpenagenticLLMConfig {...ctx} />;
    case 'multi_agent':
      return <MultiAgentConfig {...ctx} />;
    case 'bedrock':
      return <BedrockConfig {...ctx} />;
    case 'vertex':
      return <VertexConfig {...ctx} />;
    case 'azure_ai':
      return <AzureAIConfig {...ctx} />;
    case 'code':
      return <CodeConfig {...ctx} />;
    case 'condition':
      return <ConditionConfig {...ctx} />;
    case 'transform':
      return <TransformConfig {...ctx} />;
    case 'http_request':
      return <HttpRequestConfig {...ctx} />;
    case 'approval':
    case 'human_approval':
      return <ApprovalConfig {...ctx} />;
    case 'wait':
      return <WaitConfig {...ctx} />;
    case 'agent_spawn':
    case 'a2a':
      return <AgentSpawnConfig {...ctx} />;
    case 'agent_single':
      return <AgentSingleConfig {...ctx} />;
    case 'agent_pool':
      return <AgentPoolConfig {...ctx} />;
    case 'agent_supervisor':
      return <AgentSupervisorConfig {...ctx} />;
    case 'synth':
      return <SynthConfig {...ctx} />;
    case 'loop':
      return <LoopConfig {...ctx} />;
    case 'merge':
      return <MergeConfig {...ctx} />;
    case 'text':
      return <TextNoteConfig {...ctx} />;
    case 'error_handler':
      return <ErrorHandlerConfig {...ctx} />;
    case 'slack_message':
      return <SlackConfig {...ctx} />;
    case 'teams_message':
      return <TeamsConfig {...ctx} />;
    case 'outlook_email':
    case 'send_email':
      return <EmailConfig {...ctx} />;
    case 'pagerduty_incident':
      return <PagerDutyConfig {...ctx} />;
    case 'servicenow_ticket':
      return <ServiceNowConfig {...ctx} />;
    case 'jira_issue':
      return <JiraConfig {...ctx} />;
    case 'discord_message':
      return <DiscordConfig {...ctx} />;
    case 'user_context':
      return <UserContextConfig {...ctx} />;
    case 'rag_query':
      return <RagQueryConfig {...ctx} />;
    case 'file_upload':
      return <FileUploadConfig {...ctx} />;
    case 'webhook_response':
      return <WebhookResponseConfig {...ctx} />;
    case 'switch':
      return <SwitchConfig {...ctx} />;
    case 'parallel':
      return <ParallelConfig {...ctx} />;
    case 'reasoning':
      return <ReasoningConfig {...ctx} />;
    default:
      // Generic schema-driven renderer — fires for any node type that's
      // migrated to the schema registry but doesn't have an explicit
      // case above. Loops schema.settings[] and emits an input per
      // setting based on its declared type, with required-field markers
      // pulled from the schema (NOT the legacy NODE_REQUIRED_FIELDS map).
      // Closes the gap users hit when a node says "X is required" via
      // the validator but the panel has no input for X.
      return <SchemaDrivenConfig {...ctx} />;
  }
};
