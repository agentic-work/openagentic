/**
 * Pipeline Management Service
 * Handles creation, execution, and monitoring of data/prompt pipelines
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import type { Prisma } from '@prisma/client';
import { EventEmitter } from 'events';

const logger = loggers.services;

export interface PipelineCreateInput {
  name: string;
  description?: string;
  type: 'data' | 'prompt' | 'workflow';
  config: Record<string, any>;
  createdBy: string;
}

export interface NodeCreateInput {
  pipelineId: string;
  nodeType: 'input' | 'process' | 'output' | 'decision';
  positionX: number;
  positionY: number;
  config: Record<string, any>;
}

export interface EdgeCreateInput {
  pipelineId: string;
  fromNodeId: string;
  toNodeId: string;
  condition?: Record<string, any>;
}

export interface ExecutionContext {
  pipelineId: string;
  executionId: string;
  inputData: any;
  variables: Map<string, any>;
  results: Map<string, any>;
}

class PipelineExecutor extends EventEmitter {
  private context: ExecutionContext;

  constructor(context: ExecutionContext) {
    super();
    this.context = context;
  }

  async executeNode(nodeId: string, inputData: any): Promise<any> {
    const node = await prisma.pipelineNode.findUnique({
      where: { id: nodeId }
    });

    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const config = node.config as Record<string, any>;
    let result: any;

    try {
      switch (node.node_type) {
        case 'input':
          result = this.processInputNode(config, inputData);
          break;
        case 'process':
          result = await this.processNode(config, inputData);
          break;
        case 'decision':
          result = this.processDecisionNode(config, inputData);
          break;
        case 'output':
          result = this.processOutputNode(config, inputData);
          break;
        default:
          throw new Error(`Unknown node type: ${node.node_type}`);
      }

      this.context.results.set(nodeId, result);
      this.emit('nodeCompleted', { nodeId, result });
      return result;
    } catch (error) {
      this.emit('nodeError', { nodeId, error });
      throw error;
    }
  }

  private processInputNode(config: any, inputData: any): any {
    // Extract and validate input based on config
    const { fields, validation } = config;
    const result: any = {};

    for (const field of fields || []) {
      if (inputData[field.name]) {
        result[field.name] = inputData[field.name];
      } else if (field.required) {
        throw new Error(`Required field missing: ${field.name}`);
      }
    }

    return result;
  }

  private async processNode(config: any, inputData: any): Promise<any> {
    const { operation, parameters } = config;

    // Simulate different operations
    switch (operation) {
      case 'transform':
        return this.transformData(inputData, parameters);
      case 'filter':
        return this.filterData(inputData, parameters);
      case 'aggregate':
        return this.aggregateData(inputData, parameters);
      case 'llm_call':
        return await this.callLLM(inputData, parameters);
      default:
        return inputData;
    }
  }

  private processDecisionNode(config: any, inputData: any): any {
    const { conditions } = config;

    for (const condition of conditions || []) {
      if (this.evaluateCondition(condition, inputData)) {
        return { branch: condition.branch, data: inputData };
      }
    }

    return { branch: 'default', data: inputData };
  }

  private processOutputNode(config: any, inputData: any): any {
    const { format, fields } = config;
    
    if (format === 'selective' && fields) {
      const result: any = {};
      for (const field of fields) {
        if (inputData[field]) {
          result[field] = inputData[field];
        }
      }
      return result;
    }

    return inputData;
  }

  private transformData(data: any, parameters: any): any {
    // Simple transformation logic
    if (parameters.mapping) {
      const result: any = {};
      for (const [from, to] of Object.entries(parameters.mapping)) {
        result[to as string] = data[from];
      }
      return result;
    }
    return data;
  }

  private filterData(data: any, parameters: any): any {
    if (Array.isArray(data) && parameters.condition) {
      return data.filter(item => this.evaluateCondition(parameters.condition, item));
    }
    return data;
  }

  private aggregateData(data: any, parameters: any): any {
    if (Array.isArray(data) && parameters.operation) {
      switch (parameters.operation) {
        case 'count':
          return { count: data.length };
        case 'sum':
          return { sum: data.reduce((acc, item) => acc + (item[parameters.field] || 0), 0) };
        case 'average':
          const sum = data.reduce((acc, item) => acc + (item[parameters.field] || 0), 0);
          return { average: data.length > 0 ? sum / data.length : 0 };
        default:
          return data;
      }
    }
    return data;
  }

  private async callLLM(data: any, parameters: any): Promise<any> {
    // Simulate LLM call - in production, this would call the actual LLM service
    const { prompt, model } = parameters;
    
    // Format prompt with data
    let formattedPrompt = prompt;
    for (const [key, value] of Object.entries(data)) {
      formattedPrompt = formattedPrompt.replace(`{{${key}}}`, String(value));
    }

    // Simulate response
    return {
      prompt: formattedPrompt,
      response: `Simulated response for: ${formattedPrompt.substring(0, 50)}...`,
      model: model || process.env.AZURE_OPENAI_DEPLOYMENT || 'default',
      timestamp: new Date()
    };
  }

  private evaluateCondition(condition: any, data: any): boolean {
    const { field, operator, value } = condition;
    const fieldValue = data[field];

    switch (operator) {
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'greater_than':
        return fieldValue > value;
      case 'less_than':
        return fieldValue < value;
      case 'contains':
        return String(fieldValue).includes(value);
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      default:
        return false;
    }
  }
}

export class PipelineService {
  /**
   * Create a new pipeline
   */
  async createPipeline(input: PipelineCreateInput) {
    try {
      const pipeline = await prisma.pipeline.create({
        data: {
          name: input.name,
          description: input.description,
          type: input.type,
          config: input.config,
          created_by: input.createdBy,
          is_active: true
        }
      });

      logger.info('Created pipeline', {
        pipelineId: pipeline.id,
        name: pipeline.name,
        type: pipeline.type
      });

      return pipeline;
    } catch (error) {
      logger.error('Failed to create pipeline', { error, input });
      throw error;
    }
  }

  /**
   * Add a node to a pipeline
   */
  async addNode(input: NodeCreateInput) {
    try {
      const node = await prisma.pipelineNode.create({
        data: {
          pipeline_id: input.pipelineId,
          node_type: input.nodeType,
          position_x: input.positionX,
          position_y: input.positionY,
          config: input.config
        }
      });

      logger.info('Added node to pipeline', {
        nodeId: node.id,
        pipelineId: input.pipelineId,
        nodeType: input.nodeType
      });

      return node;
    } catch (error) {
      logger.error('Failed to add node', { error, input });
      throw error;
    }
  }

  /**
   * Connect two nodes with an edge
   */
  async connectNodes(input: EdgeCreateInput) {
    try {
      const edge = await prisma.pipelineEdge.create({
        data: {
          pipeline_id: input.pipelineId,
          from_node_id: input.fromNodeId,
          to_node_id: input.toNodeId,
          condition: input.condition
        }
      });

      logger.info('Connected nodes', {
        edgeId: edge.id,
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId
      });

      return edge;
    } catch (error) {
      logger.error('Failed to connect nodes', { error, input });
      throw error;
    }
  }

  /**
   * Execute a pipeline
   */
  async executePipeline(pipelineId: string, inputData: any) {
    const startTime = Date.now();
    
    try {
      // Get pipeline with nodes and edges
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: pipelineId },
        include: {
          nodes: true,
          edges: true
        }
      });

      if (!pipeline) {
        throw new Error('Pipeline not found');
      }

      if (!pipeline.is_active) {
        throw new Error('Pipeline is not active');
      }

      // Create execution record
      const execution = await prisma.pipelineExecution.create({
        data: {
          pipeline_id: pipelineId,
          status: 'running',
          input_data: inputData
        }
      });

      // Create execution context
      const context: ExecutionContext = {
        pipelineId,
        executionId: execution.id,
        inputData,
        variables: new Map(),
        results: new Map()
      };

      const executor = new PipelineExecutor(context);
      
      // Listen to execution events
      const executionLog: any[] = [];
      
      executor.on('nodeCompleted', (event) => {
        executionLog.push({
          type: 'node_completed',
          nodeId: event.nodeId,
          timestamp: new Date()
        });
      });

      executor.on('nodeError', (event) => {
        executionLog.push({
          type: 'node_error',
          nodeId: event.nodeId,
          error: String(event.error),
          timestamp: new Date()
        });
      });

      // Build execution graph
      const nodeMap = new Map(pipeline.nodes.map(n => [n.id, n]));
      const adjacencyList = new Map<string, string[]>();

      for (const edge of pipeline.edges) {
        if (!adjacencyList.has(edge.from_node_id)) {
          adjacencyList.set(edge.from_node_id, []);
        }
        adjacencyList.get(edge.from_node_id)!.push(edge.to_node_id);
      }

      // Find input nodes (nodes with no incoming edges)
      const inputNodes = pipeline.nodes.filter(node => 
        !pipeline.edges.some(edge => edge.to_node_id === node.id)
      );

      // Execute pipeline (simplified BFS traversal)
      const queue = [...inputNodes.map(n => n.id)];
      const visited = new Set<string>();
      let lastResult = inputData;

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        // Execute node
        lastResult = await executor.executeNode(nodeId, lastResult);

        // Add connected nodes to queue
        const nextNodes = adjacencyList.get(nodeId) || [];
        queue.push(...nextNodes);
      }

      // Update execution record
      const duration = Date.now() - startTime;
      
      await prisma.pipelineExecution.update({
        where: { id: execution.id },
        data: {
          status: 'completed',
          output_data: lastResult,
          execution_log: executionLog,
          completed_at: new Date(),
          duration_ms: duration
        }
      });

      logger.info('Pipeline execution completed', {
        pipelineId,
        executionId: execution.id,
        duration
      });

      return {
        executionId: execution.id,
        status: 'completed',
        output: lastResult,
        duration
      };
    } catch (error) {
      logger.error('Pipeline execution failed', { error, pipelineId });
      
      // Update execution record with error
      if (error instanceof Error) {
        await prisma.pipelineExecution.updateMany({
          where: {
            pipeline_id: pipelineId,
            status: 'running'
          },
          data: {
            status: 'failed',
            error_message: error.message,
            completed_at: new Date(),
            duration_ms: Date.now() - startTime
          }
        });
      }
      
      throw error;
    }
  }

  /**
   * Get pipeline execution history
   */
  async getExecutionHistory(pipelineId: string, limit: number = 20) {
    try {
      const executions = await prisma.pipelineExecution.findMany({
        where: { pipeline_id: pipelineId },
        orderBy: { started_at: 'desc' },
        take: limit
      });

      return executions;
    } catch (error) {
      logger.error('Failed to get execution history', { error, pipelineId });
      throw error;
    }
  }

  /**
   * Get pipeline with full details
   */
  async getPipelineDetails(pipelineId: string) {
    try {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: pipelineId },
        include: {
          nodes: true,
          edges: true,
          executions: {
            orderBy: { started_at: 'desc' },
            take: 5
          }
        }
      });

      return pipeline;
    } catch (error) {
      logger.error('Failed to get pipeline details', { error, pipelineId });
      throw error;
    }
  }

  /**
   * List pipelines with optional filters
   */
  async listPipelines(filter?: { type?: string; isActive?: boolean }) {
    try {
      const where: any = {};
      if (filter?.type) {
        where.type = filter.type;
      }
      if (filter?.isActive !== undefined) {
        where.is_active = filter.isActive;
      }

      const pipelines = await prisma.pipeline.findMany({
        where,
        include: {
          nodes: {
            select: { id: true, node_type: true }
          },
          edges: {
            select: { id: true }
          },
          executions: {
            where: { status: 'completed' },
            select: { id: true },
            take: 1
          }
        },
        orderBy: { created_at: 'desc' }
      });

      return pipelines.map(p => ({
        ...p,
        nodeCount: p.nodes.length,
        edgeCount: p.edges.length,
        hasExecutions: p.executions.length > 0
      }));
    } catch (error) {
      logger.error('Failed to list pipelines', { error, filter });
      throw error;
    }
  }

  /**
   * Clone a pipeline
   */
  async clonePipeline(pipelineId: string, newName: string, createdBy: string) {
    try {
      const source = await this.getPipelineDetails(pipelineId);
      
      if (!source) {
        throw new Error('Source pipeline not found');
      }

      // Create new pipeline
      const newPipeline = await prisma.pipeline.create({
        data: {
          name: newName,
          description: `Cloned from ${source.name}`,
          type: source.type,
          config: source.config,
          created_by: createdBy,
          is_active: true
        }
      });

      // Clone nodes
      const nodeMapping = new Map<string, string>();
      
      for (const node of source.nodes) {
        const newNode = await prisma.pipelineNode.create({
          data: {
            pipeline_id: newPipeline.id,
            node_type: node.node_type,
            position_x: node.position_x,
            position_y: node.position_y,
            config: node.config
          }
        });
        nodeMapping.set(node.id, newNode.id);
      }

      // Clone edges with new node IDs
      for (const edge of source.edges) {
        await prisma.pipelineEdge.create({
          data: {
            pipeline_id: newPipeline.id,
            from_node_id: nodeMapping.get(edge.from_node_id)!,
            to_node_id: nodeMapping.get(edge.to_node_id)!,
            condition: edge.condition
          }
        });
      }

      logger.info('Cloned pipeline', {
        sourcePipelineId: pipelineId,
        newPipelineId: newPipeline.id,
        newName
      });

      return newPipeline;
    } catch (error) {
      logger.error('Failed to clone pipeline', { error, pipelineId });
      throw error;
    }
  }
}

export const pipelineService = new PipelineService();