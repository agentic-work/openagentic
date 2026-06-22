# Workflows Feature

Visual workflow builder inspired by n8n, adapted for OpenAgenticChat's unique capabilities.

## Features

- 🎨 **Visual Node-Based Editor** - Drag-and-drop workflow canvas powered by ReactFlow
- 🔧 **MCP Tool Integration** - All your MCP servers (admin, memory, azure, etc.) as workflow nodes
- 🤖 **AI-Powered Nodes** - LLM completion nodes for intelligent automation
- 💻 **Code Execution** - Custom JavaScript/Python/Bash code nodes
- 🔀 **Logic & Control** - Conditional branching, loops, and data transformation
- ⚡ **Real-time Execution** - Live workflow execution with visual progress
- 📊 **Execution History** - Track and replay workflow runs
- 🎯 **Multiple Triggers** - Manual, schedule, chat message, file upload, webhooks

## Quick Start

### 1. Add Workflow Route

```tsx
// src/app/App.tsx
import { WorkflowList, WorkflowBuilder } from '@/features/workflows';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ... existing routes ... */}
        <Route path="/workflows" element={<WorkflowList />} />
        <Route path="/workflows/:id" element={<WorkflowBuilder />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### 2. Install Dependencies

```bash
cd services/openagentic-ui
pnpm install
```

This will install `reactflow` (the workflow canvas library).

### 3. Use the Workflow Builder

```tsx
import { WorkflowBuilder } from '@/features/workflows';
import { useMCPTools } from '@/features/chat/hooks/useMCPTools';

function MyWorkflowPage() {
  const { availableMCPFunctions } = useMCPTools();

  return (
    <WorkflowBuilder
      mcpTools={availableMCPFunctions.map((tool) => ({
        serverId: tool.server,
        serverName: tool.serverName,
        toolName: tool.name,
        description: tool.description,
      }))}
      onSave={async (workflow) => {
        // Save to backend
        await fetch('/api/workflows', {
          method: 'POST',
          body: JSON.stringify(workflow),
        });
      }}
      onExecute={async (workflow) => {
        // Execute workflow
        await fetch('/api/workflows/execute', {
          method: 'POST',
          body: JSON.stringify(workflow),
        });
      }}
      theme="dark"
    />
  );
}
```

## Components

### WorkflowList

Dashboard view of all user workflows.

```tsx
<WorkflowList
  workflows={workflows}
  onCreateNew={() => navigate('/workflows/new')}
  onEdit={(id) => navigate(`/workflows/${id}`)}
  onExecute={(id) => executeWorkflow(id)}
  onDelete={(id) => deleteWorkflow(id)}
  theme="dark"
/>
```

### WorkflowBuilder

Full-featured workflow editor.

```tsx
<WorkflowBuilder
  workflowId="workflow-123"
  initialWorkflow={savedWorkflow}
  mcpTools={mcpTools}
  onSave={handleSave}
  onExecute={handleExecute}
  theme="dark"
/>
```

### WorkflowCanvas

Just the canvas without chrome (for embedding).

```tsx
<WorkflowCanvas
  workflow={workflowDefinition}
  onChange={handleChange}
  executionState={executionState}
  theme="dark"
/>
```

### NodePalette

Draggable node library.

```tsx
<NodePalette
  mcpTools={mcpTools}
  onNodeDragStart={handleDragStart}
  theme="dark"
/>
```

## Node Types

### Trigger Nodes

Start workflows based on events:

- **Manual Trigger** - Run on-demand
- **Schedule** - Cron-based scheduling
- **Chat Message** - Trigger on user messages
- **File Upload** - Trigger on file uploads
- **Webhook** - External HTTP triggers

### MCP Tool Nodes

Execute your MCP tools:

- Auto-generated from your MCP servers
- Configurable arguments
- Real-time execution
- Error handling

### LLM Nodes

AI-powered processing:

- **LLM Completion** - Generate AI responses
- **Summarization** - Condense content
- Configurable model, temperature, max tokens

### Logic Nodes

Control flow:

- **If/Else** - Conditional branching
- **Filter** - Data filtering
- **Loop** - Iteration
- **Merge** - Combine data streams

### Code Nodes

Custom code execution:

- **JavaScript** - Node.js runtime
- **Python** - Python 3.x
- **Bash** - Shell scripts

## Workflow Definition

Workflows are defined as JSON:

```typescript
{
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 100, y: 100 },
      data: {
        label: 'Manual Trigger',
        triggerType: 'manual'
      }
    },
    {
      id: 'mcp-1',
      type: 'mcp_tool',
      position: { x: 400, y: 100 },
      data: {
        label: 'Get Azure Costs',
        toolName: 'get_costs',
        toolServer: 'azure-cost-mcp',
        arguments: { subscription: 'prod' }
      }
    },
    {
      id: 'llm-1',
      type: 'llm_completion',
      position: { x: 700, y: 100 },
      data: {
        label: 'Summarize',
        model: 'claude-sonnet-4-5',
        prompt: 'Summarize the cost data'
      }
    }
  ],
  edges: [
    {
      id: 'edge-1',
      source: 'trigger-1',
      target: 'mcp-1'
    },
    {
      id: 'edge-2',
      source: 'mcp-1',
      target: 'llm-1'
    }
  ]
}
```

## Backend Integration

### Save Workflow

```typescript
// POST /api/workflows
{
  name: "Daily Cost Report",
  description: "Generates cost summary every day",
  definition: { nodes: [...], edges: [...] },
  status: "active"
}
```

### Execute Workflow

```typescript
// POST /api/workflows/:id/execute
// Returns execution ID

// GET /api/workflows/executions/:executionId
{
  id: "exec-123",
  status: "running",
  logs: [
    {
      nodeId: "trigger-1",
      status: "completed",
      output: {...}
    },
    {
      nodeId: "mcp-1",
      status: "running",
      ...
    }
  ]
}
```

## Example Workflows

### 1. Automated Cost Reporting

```
Schedule (Daily 9AM)
  → Azure Cost Query (azure-cost-mcp)
  → Filter > $1000 (condition)
  → Generate Summary (LLM)
  → Notify Admins (admin-mcp)
```

### 2. Document Q&A Pipeline

```
File Upload Trigger
  → Extract Text (code node)
  → Generate Embeddings (LLM)
  → Store in Milvus (memory-mcp)
  → Add to Chat (completion)
```

### 3. Multi-Step Analysis

```
User Query
  → Query Database (postgres-mcp)
  → If empty: Web Search (brave-search-mcp)
  → Analyze Data (sequential-thinking)
  → Generate Report (LLM)
  → Save to Filesystem (filesystem-mcp)
```

## Styling

Uses your existing theme system with dark/light mode support:

```tsx
<WorkflowBuilder theme={settings.theme} />
```

All components respect:
- Glassmorphism effects
- Your color palette (gray-900, blue-500, etc.)
- Consistent border radii
- Framer Motion animations
- Lucide icons

## Architecture

```
services/openagentic-ui/src/features/workflows/
├── components/
│   ├── WorkflowBuilder.tsx       # Main editor
│   ├── WorkflowList.tsx          # Dashboard
│   ├── WorkflowCanvas.tsx        # ReactFlow canvas
│   ├── NodePalette.tsx           # Node library
│   └── nodes/
│       ├── TriggerNode.tsx       # Trigger nodes
│       ├── MCPToolNode.tsx       # MCP tool nodes
│       ├── LLMNode.tsx           # AI nodes
│       ├── CodeNode.tsx          # Code execution
│       └── ConditionNode.tsx     # Logic nodes
├── types/
│   └── workflow.types.ts         # TypeScript definitions
└── index.tsx                     # Public exports
```

## Next Steps

1. **Backend API** - Implement workflow CRUD and execution endpoints
2. **Execution Engine** - Build workflow executor service
3. **Templates** - Create pre-built workflow templates
4. **Scheduling** - Integrate cron-based triggers
5. **Webhooks** - Add webhook trigger support
6. **Collaboration** - Share workflows between users

## License

Part of OpenAgenticChat - U.S. Government work.
