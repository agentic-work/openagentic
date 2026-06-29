/**
 * Integration / notification node config groups: HTTP request, approval,
 * error handler, Slack, Teams, email, PagerDuty, ServiceNow, Jira, Discord,
 * RAG query, and knowledge-base file upload.
 */

import React from 'react';
import { isFieldRequired } from '../../../utils/workflowValidator';
import { FormInput, FormTextarea, FormSelect } from '../FormControls';
import { AdvancedToggle } from '../AdvancedToggle';
import type { NodeConfigContext } from '../types';

export const HttpRequestConfig: React.FC<NodeConfigContext> = ({ editor, isDark, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, fieldNum, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormSelect
        label="Method"
        value={fieldStr('method', 'GET')}
        onChange={(v) => updateData('method', v)}
        options={[
          { value: 'GET', label: 'GET' },
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'DELETE', label: 'DELETE' },
          { value: 'PATCH', label: 'PATCH' },
        ]}
        isDark={isDark}
        helpText="HTTP method for the request. GET for fetching data, POST for creating, PUT/PATCH for updating."
      />
      <FormInput
        label="URL"
        value={fieldStr('url')}
        onChange={(v) => updateData('url', v)}
        placeholder="https://api.example.com/endpoint"
        isDark={isDark}
        helpText="Use {{variable}} for dynamic values"
        required={isFieldRequired('http_request', 'url')}
        error={isFieldRequired('http_request', 'url') && !fieldStr('url').trim()}
      />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormTextarea
          label="Headers (JSON)"
          value={fieldStr('headers', '{}')}
          onChange={(v) => updateData('headers', v)}
          rows={4}
          placeholder={'{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer {{token}}"\n}'}
          isDark={isDark}
          monospace
          helpText="JSON object of request headers"
        />
        <FormTextarea
          label="Body"
          value={fieldStr('body')}
          onChange={(v) => updateData('body', v)}
          rows={6}
          placeholder={'{\n  "key": "value"\n}'}
          isDark={isDark}
          monospace
          helpText="Request body (for POST/PUT/PATCH)"
        />
        <FormInput
          label="Timeout (ms)"
          value={fieldNum('timeout', 30000)}
          onChange={(v) => updateData('timeout', v)}
          type="number"
          isDark={isDark}
          min={1000}
          max={300000}
          helpText="Request timeout in milliseconds"
        />
      </AdvancedToggle>
    </div>
  );
};

export const ApprovalConfig: React.FC<NodeConfigContext> = ({ editor, isDark, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, fieldNum, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormTextarea
        label="Approval Message"
        value={fieldStr('message')}
        onChange={(v) => updateData('message', v)}
        rows={3}
        placeholder="Please review and approve this workflow step..."
        isDark={isDark}
        helpText="Message shown to approvers"
      />
      <FormInput
        label="Approvers"
        value={fieldStr('approvers')}
        onChange={(v) => updateData('approvers', v)}
        placeholder="user@example.com, team-lead@example.com"
        isDark={isDark}
        helpText="Comma-separated email addresses"
        required={isFieldRequired('approval', 'approvers')}
        error={isFieldRequired('approval', 'approvers') && !(fieldStr('approvers') || fieldStr('approverRole') || fieldStr('notifyChannel'))}
      />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput
          label="Timeout (hours)"
          value={fieldNum('approvalTimeout', 24)}
          onChange={(v) => updateData('approvalTimeout', v)}
          type="number"
          isDark={isDark}
          min={1}
          max={720}
          helpText="Auto-reject after this many hours"
        />
        <FormInput
          label="Escalation Email"
          value={fieldStr('escalationEmail')}
          onChange={(v) => updateData('escalationEmail', v)}
          placeholder="manager@example.com"
          isDark={isDark}
          helpText="Notified if approval times out"
        />
      </AdvancedToggle>
    </div>
  );
};

export const ErrorHandlerConfig: React.FC<NodeConfigContext> = ({ editor, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, fieldNum, asField, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormSelect label="Error Action" value={fieldStr('errorAction', 'log')}
        onChange={(v) => updateData('errorAction', asField(v, 'errorAction'))}
        options={[
          { value: 'log', label: 'Log - Record and continue' },
          { value: 'retry', label: 'Retry - Re-execute failed node' },
          { value: 'notify', label: 'Notify - Send alert' },
          { value: 'transform', label: 'Transform - Convert error to output' },
        ]}
        helpText="What to do when an error reaches this handler." />
      <FormTextarea label="Error Message Template" value={fieldStr('errorMessage')}
        onChange={(v) => updateData('errorMessage', v)} rows={3}
        placeholder="Error in {{nodeId}}: {{error.message}}"
        helpText="Template for error output. Use {{error.message}}, {{error.stack}}, {{nodeId}}." />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput label="Max Retries" value={fieldNum('maxRetries', 3)}
          onChange={(v) => updateData('maxRetries', Number.parseInt(v) || 3)} type="number"
          min={0} max={10} helpText="Number of retry attempts (for retry action)." />
        <FormInput label="Retry Delay (ms)" value={fieldNum('retryDelay', 1000)}
          onChange={(v) => updateData('retryDelay', Number.parseInt(v) || 1000)} type="number"
          min={100} max={60000} helpText="Delay between retries." />
        <FormSelect label="Backoff" value={fieldStr('backoff', 'exponential')}
          onChange={(v) => updateData('backoff', v)}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'exponential', label: 'Exponential' },
          ]}
          helpText="Retry delay strategy." />
      </AdvancedToggle>
    </div>
  );
};

export const SlackConfig: React.FC<NodeConfigContext> = ({ editor, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Channel" value={fieldStr('channel')}
        onChange={(v) => updateData('channel', v)}
        placeholder="#general or C01234567"
        helpText="Slack channel name or ID."
        required error={!fieldStr('channel').trim()} />
      <FormTextarea label="Message" value={fieldStr('message')}
        onChange={(v) => updateData('message', v)} rows={4}
        placeholder="Workflow {{workflowName}} completed: {{input}}"
        helpText="Supports Slack mrkdwn and {{variable}} templates."
        required error={!fieldStr('message').trim()} />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput label="Bot Name" value={fieldStr('botName', 'OpenAgentic')}
          onChange={(v) => updateData('botName', v)} helpText="Display name for the bot." />
        <FormInput label="Thread TS" value={fieldStr('threadTs')}
          onChange={(v) => updateData('threadTs', v)}
          placeholder="Optional - reply in thread"
          helpText="Thread timestamp to reply in an existing thread." />
      </AdvancedToggle>
    </div>
  );
};

export const TeamsConfig: React.FC<NodeConfigContext> = ({ editor, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Webhook URL" value={fieldStr('webhookUrl')}
        onChange={(v) => updateData('webhookUrl', v)}
        placeholder="https://outlook.office.com/webhook/..."
        helpText="Microsoft Teams incoming webhook URL. Use {{secret:teams_webhook}} for secrets."
        required error={!fieldStr('webhookUrl').trim()} />
      <FormTextarea label="Message" value={fieldStr('message')}
        onChange={(v) => updateData('message', v)} rows={4}
        placeholder="Workflow completed with result: {{input}}"
        helpText="Message body. Supports {{variable}} templates."
        required error={!fieldStr('message').trim()} />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput label="Title" value={fieldStr('title')}
          onChange={(v) => updateData('title', v)}
          placeholder="Workflow Notification"
          helpText="Card title shown in the Teams message." />
      </AdvancedToggle>
    </div>
  );
};

export const EmailConfig: React.FC<NodeConfigContext> = ({ editor, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="To" value={fieldStr('to')}
        onChange={(v) => updateData('to', v)}
        placeholder="user@example.com"
        helpText="Recipient email address(es), comma-separated."
        required error={!fieldStr('to').trim()} />
      <FormInput label="Subject" value={fieldStr('subject')}
        onChange={(v) => updateData('subject', v)}
        placeholder="Workflow Result: {{workflowName}}"
        helpText="Email subject line. Supports {{variable}} templates."
        required error={!fieldStr('subject').trim()} />
      <FormTextarea label="Body" value={fieldStr('body')}
        onChange={(v) => updateData('body', v)} rows={6}
        placeholder="The workflow completed with the following output:\n\n{{input}}"
        helpText="Email body. Supports HTML and {{variable}} templates."
        required error={!fieldStr('body').trim()} />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput label="CC" value={fieldStr('cc')}
          onChange={(v) => updateData('cc', v)} placeholder="cc@example.com"
          helpText="CC recipients, comma-separated." />
        <FormSelect label="Format" value={fieldStr('bodyFormat', 'html')}
          onChange={(v) => updateData('bodyFormat', v)}
          options={[{ value: 'html', label: 'HTML' }, { value: 'text', label: 'Plain Text' }]}
          helpText="Email body format." />
      </AdvancedToggle>
    </div>
  );
};

export const PagerDutyConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Service ID" value={fieldStr('serviceId')}
        onChange={(v) => updateData('serviceId', v)}
        placeholder="P1234567"
        helpText="PagerDuty service ID to create the incident on."
        required error={!fieldStr('serviceId').trim()} />
      <FormInput label="Title" value={fieldStr('title')}
        onChange={(v) => updateData('title', v)}
        placeholder="[OpenAgentic] {{error.message}}"
        helpText="Incident title. Supports {{variable}} templates."
        required error={!fieldStr('title').trim()} />
      <FormSelect label="Severity" value={fieldStr('severity', 'warning')}
        onChange={(v) => updateData('severity', v)}
        options={[
          { value: 'critical', label: 'Critical' },
          { value: 'error', label: 'Error' },
          { value: 'warning', label: 'Warning' },
          { value: 'info', label: 'Info' },
        ]}
        helpText="Incident severity level." />
      <FormTextarea label="Details" value={fieldStr('details')}
        onChange={(v) => updateData('details', v)} rows={3}
        placeholder="Workflow {{workflowName}} failed at node {{nodeId}}"
        helpText="Incident body/details." />
    </div>
  );
};

export const ServiceNowConfig: React.FC<NodeConfigContext> = ({ editor, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormSelect label="Table" value={fieldStr('table', 'incident')}
        onChange={(v) => updateData('table', v)}
        options={[
          { value: 'incident', label: 'Incident' },
          { value: 'change_request', label: 'Change Request' },
          { value: 'problem', label: 'Problem' },
          { value: 'sc_request', label: 'Service Request' },
        ]}
        helpText="ServiceNow table to create the record in." />
      <FormInput label="Short Description" value={fieldStr('shortDescription')}
        onChange={(v) => updateData('shortDescription', v)}
        placeholder="Automated ticket from workflow"
        helpText="Ticket short description."
        required error={!fieldStr('shortDescription').trim()} />
      <FormTextarea label="Description" value={fieldStr('description')}
        onChange={(v) => updateData('description', v)} rows={4}
        placeholder="Workflow output:\n{{input}}"
        helpText="Full ticket description. Supports {{variable}} templates." />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormSelect label="Priority" value={fieldStr('priority', '3')}
          onChange={(v) => updateData('priority', v)}
          options={[
            { value: '1', label: '1 - Critical' },
            { value: '2', label: '2 - High' },
            { value: '3', label: '3 - Moderate' },
            { value: '4', label: '4 - Low' },
          ]}
          helpText="Ticket priority level." />
        <FormInput label="Assignment Group" value={fieldStr('assignmentGroup')}
          onChange={(v) => updateData('assignmentGroup', v)}
          placeholder="IT Operations"
          helpText="ServiceNow assignment group." />
      </AdvancedToggle>
    </div>
  );
};

export const JiraConfig: React.FC<NodeConfigContext> = ({ editor, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Project Key" value={fieldStr('projectKey')}
        onChange={(v) => updateData('projectKey', v)}
        placeholder="PROJ"
        helpText="Jira project key."
        required error={!fieldStr('projectKey').trim()} />
      <FormSelect label="Issue Type" value={fieldStr('issueType', 'Task')}
        onChange={(v) => updateData('issueType', v)}
        options={[
          { value: 'Bug', label: 'Bug' },
          { value: 'Task', label: 'Task' },
          { value: 'Story', label: 'Story' },
          { value: 'Epic', label: 'Epic' },
        ]}
        helpText="Jira issue type." />
      <FormInput label="Summary" value={fieldStr('summary')}
        onChange={(v) => updateData('summary', v)}
        placeholder="[OpenAgentic] {{workflowName}} result"
        helpText="Issue summary/title."
        required error={!fieldStr('summary').trim()} />
      <FormTextarea label="Description" value={fieldStr('jiraDescription')}
        onChange={(v) => updateData('jiraDescription', v)} rows={4}
        placeholder="Workflow output:\n\n{{input}}"
        helpText="Issue description. Supports Jira wiki markup and {{variable}} templates." />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput label="Labels" value={fieldStr('labels')}
          onChange={(v) => updateData('labels', v)}
          placeholder="openagentic, automated"
          helpText="Comma-separated labels." />
        <FormInput label="Assignee" value={fieldStr('assignee')}
          onChange={(v) => updateData('assignee', v)}
          placeholder="user@example.com"
          helpText="Jira user to assign the issue to." />
      </AdvancedToggle>
    </div>
  );
};

export const DiscordConfig: React.FC<NodeConfigContext> = ({ editor, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Webhook URL" value={fieldStr('webhookUrl')}
        onChange={(v) => updateData('webhookUrl', v)}
        placeholder="https://discord.com/api/webhooks/..."
        helpText="Discord webhook URL. Use {{secret:discord_webhook}} for secrets."
        required error={!fieldStr('webhookUrl').trim()} />
      <FormTextarea label="Message" value={fieldStr('message')}
        onChange={(v) => updateData('message', v)} rows={4}
        placeholder="Workflow completed: {{input}}"
        helpText="Message content. Supports Discord markdown and {{variable}} templates."
        required error={!fieldStr('message').trim()} />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput label="Username" value={fieldStr('username', 'OpenAgentic')}
          onChange={(v) => updateData('username', v)} helpText="Bot display name." />
      </AdvancedToggle>
    </div>
  );
};

export const RagQueryConfig: React.FC<NodeConfigContext> = ({ editor, availableModels, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, fieldNum, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Collection Name" value={fieldStr('collectionName')}
        onChange={(v) => updateData('collectionName', v)}
        placeholder="my_knowledge_base"
        helpText="Milvus collection to query."
        required error={!fieldStr('collectionName').trim()} />
      <FormTextarea label="Query" value={fieldStr('queryText')}
        onChange={(v) => updateData('queryText', v)} rows={3}
        placeholder="{{input.message}}"
        helpText="Search query text. Supports {{input}} template variables."
        required error={!fieldStr('queryText').trim()} />
      <FormInput label="Top K" value={fieldNum('topK', 10)}
        onChange={(v) => updateData('topK', Number.parseInt(v) || 10)} type="number"
        min={1} max={100} helpText="Number of results to return." />
      <FormTextarea label="Filters (JSON)" value={fieldStr('filters', '{}')}
        onChange={(v) => updateData('filters', v)} rows={2} monospace
        placeholder='{"category": "docs"}'
        helpText="Optional Milvus filter expression as JSON." />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormSelect label="Embedding Model" value={fieldStr('embeddingModel', 'auto')}
          onChange={(v) => updateData('embeddingModel', v)}
          options={[
            { value: 'auto', label: 'Auto (platform default)' },
            ...availableModels.filter(m => m.includes('embed')).map(m => ({ value: m, label: m })),
          ]}
          helpText="Model used to embed the query text." />
      </AdvancedToggle>
    </div>
  );
};

export const FileUploadConfig: React.FC<NodeConfigContext> = ({ editor, availableModels, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, fieldNum, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormInput label="Collection Name" value={fieldStr('collectionName')}
        onChange={(v) => updateData('collectionName', v)}
        placeholder="my_knowledge_base"
        helpText="Target Milvus collection for ingestion."
        required error={!fieldStr('collectionName').trim()} />
      <FormSelect label="Source Type" value={fieldStr('fileSource', 'input_data')}
        onChange={(v) => updateData('fileSource', v)}
        options={[
          { value: 'input_data', label: 'Input Data - From upstream node' },
          { value: 'url', label: 'URL - Fetch from remote URL' },
          { value: 'file_path', label: 'File Path - Local/mounted path' },
        ]}
        helpText="Where to read the file from." />
      <FormInput label="Chunk Size" value={fieldNum('chunkSize', 512)}
        onChange={(v) => updateData('chunkSize', Number.parseInt(v) || 512)} type="number"
        min={64} max={8192} helpText="Characters per chunk for splitting." />
      <FormInput label="Chunk Overlap" value={fieldNum('chunkOverlap', 50)}
        onChange={(v) => updateData('chunkOverlap', Number.parseInt(v) || 50)} type="number"
        min={0} max={1024} helpText="Overlap between adjacent chunks." />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormSelect label="Embedding Model" value={fieldStr('embeddingModel', 'auto')}
          onChange={(v) => updateData('embeddingModel', v)}
          options={[
            { value: 'auto', label: 'Auto (platform default)' },
            ...availableModels.filter(m => m.includes('embed')).map(m => ({ value: m, label: m })),
          ]}
          helpText="Model used to generate embeddings." />
      </AdvancedToggle>
    </div>
  );
};
