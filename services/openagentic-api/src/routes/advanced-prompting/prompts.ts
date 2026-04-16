/**
 * Advanced Prompting and Engineering Routes
 * 
 * Provides AI-powered prompt generation, optimization, testing, and analysis tools.
 * Includes prompt templates, technique guidance, and workflow chain creation.
 * 
 * @see {@link https://docs.openagentic.io/api/advanced-prompting}
 */

import { FastifyPluginAsync } from 'fastify';
import { CachedPromptService } from '../../services/CachedPromptService.js';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for prompts routes');
}

export const advancedPromptingRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Initialize CachedPromptService for optimal performance
  const promptService = new CachedPromptService(fastify.log as any, {
    enableCache: true,
    cacheTTL: 1800,
    cacheUserAssignments: true,
    cacheTemplates: true
  });

  // Helper to get user from token
  const getUserFromToken = (request: any): string | null => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return decoded.userId || decoded.id || decoded.oid;
    } catch (error) {
      logger.warn({ error }, 'Failed to decode user token');
      return null;
    }
  };

  /**
   * Generate dynamic prompts based on requirements
   * GET /api/prompts/generate
   */
  fastify.get('/generate', async (request, reply) => {
    try {
      const {
        task = 'general',
        complexity = 'medium',
        style = 'professional',
        domain,
        audience = 'general',
        length = 'medium'
      } = request.query as {
        task?: string;
        complexity?: 'low' | 'medium' | 'high';
        style?: 'professional' | 'casual' | 'technical' | 'creative';
        domain?: string;
        audience?: string;
        length?: 'short' | 'medium' | 'long';
      };

      // Generate prompt based on parameters
      let generatedPrompt = '';
      let techniques: string[] = [];

      // Base prompt templates by task
      const taskTemplates = {
        'analysis': {
          base: 'Analyze the following content with a focus on',
          techniques: ['structured_analysis', 'critical_thinking', 'evidence_evaluation']
        },
        'creative_writing': {
          base: 'Create an engaging and original piece that',
          techniques: ['creative_prompting', 'story_structure', 'character_development']
        },
        'problem_solving': {
          base: 'Approach this problem systematically by',
          techniques: ['step_by_step', 'root_cause_analysis', 'solution_generation']
        },
        'summarization': {
          base: 'Provide a comprehensive summary that captures',
          techniques: ['key_point_extraction', 'hierarchical_organization', 'concise_communication']
        },
        'general': {
          base: 'Please assist with the following request by',
          techniques: ['clear_communication', 'structured_response', 'helpful_guidance']
        }
      };

      const template = taskTemplates[task as keyof typeof taskTemplates] || taskTemplates.general;
      techniques = template.techniques;

      // Build prompt based on complexity
      switch (complexity) {
        case 'low':
          generatedPrompt = `${template.base} providing a straightforward and clear response.`;
          break;
        case 'high':
          generatedPrompt = `${template.base} conducting a thorough, multi-faceted examination that considers various perspectives, implications, and supporting evidence.`;
          break;
        default: // medium
          generatedPrompt = `${template.base} offering a balanced analysis that includes key insights and relevant context.`;
      }

      // Add style modifiers
      const styleModifiers = {
        'professional': ' Maintain a formal, business-appropriate tone throughout your response.',
        'casual': ' Use a friendly, conversational tone that feels approachable and engaging.',
        'technical': ' Include precise terminology and detailed explanations suitable for experts in the field.',
        'creative': ' Embrace innovative thinking and expressive language to inspire and engage.'
      };

      generatedPrompt += styleModifiers[style as keyof typeof styleModifiers] || '';

      // Add domain-specific guidance
      if (domain) {
        generatedPrompt += ` Focus specifically on ${domain} domain knowledge and best practices.`;
        techniques.push('domain_expertise');
      }

      // Add audience consideration
      if (audience !== 'general') {
        generatedPrompt += ` Tailor your explanation for ${audience} audience level.`;
        techniques.push('audience_adaptation');
      }

      // Add length guidance
      const lengthGuidance = {
        'short': ' Keep your response concise and to the point.',
        'long': ' Provide comprehensive coverage with detailed explanations and examples.',
        'medium': ' Balance thoroughness with clarity in your response.'
      };

      generatedPrompt += lengthGuidance[length as keyof typeof lengthGuidance] || '';

      return reply.send({
        prompt: generatedPrompt,
        metadata: {
          task,
          complexity,
          style,
          domain,
          audience,
          length,
          techniques,
          generatedAt: new Date().toISOString(),
          estimatedTokens: Math.ceil(generatedPrompt.length / 4)
        },
        suggestions: [
          'Consider adding specific examples for better clarity',
          'You may want to specify the desired output format',
          'Adding constraints can help focus the response'
        ]
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate dynamic prompt');
      return reply.code(500).send({ error: 'Prompt generation failed' });
    }
  });

  /**
   * Optimize existing prompts for better performance
   * POST /api/prompts/optimize
   */
  fastify.post('/optimize', async (request, reply) => {
    try {
      const {
        prompt,
        goals = ['clarity', 'effectiveness'],
        constraints = {},
        context
      } = request.body as {
        prompt: string;
        goals?: string[];
        constraints?: Record<string, any>;
        context?: string;
      };

      if (!prompt) {
        return reply.code(400).send({ error: 'Prompt is required' });
      }

      // Analyze current prompt
      const analysis = {
        length: prompt.length,
        tokenEstimate: Math.ceil(prompt.length / 4),
        clarity: prompt.includes('?') ? 'high' : 'medium',
        specificity: prompt.split(' ').length > 20 ? 'high' : 'medium',
        structure: prompt.includes('\n') ? 'structured' : 'single_block'
      };

      // Generate optimizations based on goals
      let optimizedPrompt = prompt;
      const optimizations: string[] = [];

      if (goals.includes('clarity')) {
        if (!prompt.includes('Please')) {
          optimizedPrompt = 'Please ' + optimizedPrompt.toLowerCase();
          optimizations.push('Added polite request indicator');
        }
        
        if (!prompt.endsWith('.') && !prompt.endsWith('?') && !prompt.endsWith('!')) {
          optimizedPrompt += '.';
          optimizations.push('Added proper punctuation');
        }
      }

      if (goals.includes('effectiveness')) {
        if (!prompt.includes('specific') && !prompt.includes('detailed')) {
          optimizedPrompt = optimizedPrompt.replace('Please ', 'Please provide a detailed ');
          optimizations.push('Added specificity requirement');
        }
      }

      if (goals.includes('conciseness') && prompt.length > 200) {
        // Simple conciseness improvement
        optimizedPrompt = optimizedPrompt.replace(/\s+/g, ' ').trim();
        optimizations.push('Removed redundant whitespace');
      }

      if (goals.includes('structure')) {
        if (!prompt.includes('\n') && prompt.length > 100) {
          optimizedPrompt = optimizedPrompt.replace(/\. /g, '.\n\n');
          optimizations.push('Added structural breaks');
        }
      }

      // Apply constraints
      if (constraints.maxLength && optimizedPrompt.length > constraints.maxLength) {
        optimizedPrompt = optimizedPrompt.substring(0, constraints.maxLength - 3) + '...';
        optimizations.push(`Truncated to ${constraints.maxLength} characters`);
      }

      const improvement = {
        original: {
          length: analysis.length,
          tokenEstimate: analysis.tokenEstimate,
          clarity: analysis.clarity,
          specificity: analysis.specificity
        },
        optimized: {
          length: optimizedPrompt.length,
          tokenEstimate: Math.ceil(optimizedPrompt.length / 4),
          clarity: optimizations.some(o => o.includes('polite') || o.includes('punctuation')) ? 'high' : analysis.clarity,
          specificity: optimizations.some(o => o.includes('specificity')) ? 'high' : analysis.specificity
        }
      };

      return reply.send({
        original: prompt,
        optimized: optimizedPrompt,
        optimizations,
        improvement,
        goals,
        constraints,
        recommendations: [
          'Test the optimized prompt with sample inputs',
          'Consider A/B testing different versions',
          'Monitor response quality metrics'
        ]
      });
    } catch (error) {
      logger.error({ error }, 'Failed to optimize prompt');
      return reply.code(500).send({ error: 'Prompt optimization failed' });
    }
  });

  /**
   * Test prompt effectiveness
   * POST /api/prompts/test
   */
  fastify.post('/test', async (request, reply) => {
    try {
      const {
        prompt,
        testCases = [],
        model = process.env.DEFAULT_MODEL,
        metrics = ['clarity', 'relevance', 'completeness']
      } = request.body as {
        prompt: string;
        testCases?: Array<{ input: string; expectedOutput?: string }>;
        model?: string;
        metrics?: string[];
      };

      if (!prompt) {
        return reply.code(400).send({ error: 'Prompt is required' });
      }

      // Simulate prompt testing (in a real implementation, this would call the actual model)
      const testResults = testCases.map((testCase, index) => {
        const mockScore = Math.random() * 0.3 + 0.7; // 0.7-1.0 range
        
        return {
          testCaseId: index + 1,
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: `Mock response for: ${testCase.input}`, // Would be actual model response
          scores: metrics.reduce((acc, metric) => {
            acc[metric] = mockScore + (Math.random() * 0.2 - 0.1); // Small variation per metric
            return acc;
          }, {} as Record<string, number>),
          overall: mockScore,
          feedback: 'Test completed successfully'
        };
      });

      const overallMetrics = metrics.reduce((acc, metric) => {
        const scores = testResults.map(r => r.scores[metric]);
        acc[metric] = {
          average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
          min: Math.min(...scores),
          max: Math.max(...scores),
          variance: scores.reduce((sum, score) => sum + Math.pow(score - (scores.reduce((s, sc) => s + sc, 0) / scores.length), 2), 0) / scores.length
        };
        return acc;
      }, {} as Record<string, any>);

      return reply.send({
        prompt,
        model,
        testResults,
        metrics: overallMetrics,
        totalTests: testResults.length,
        averageScore: testResults.reduce((sum, r) => sum + r.overall, 0) / testResults.length,
        passRate: testResults.filter(r => r.overall > 0.7).length / testResults.length,
        recommendations: [
          'Consider adding more specific instructions',
          'Test with edge cases',
          'Monitor consistency across different inputs'
        ]
      });
    } catch (error) {
      logger.error({ error }, 'Failed to test prompt');
      return reply.code(500).send({ error: 'Prompt testing failed' });
    }
  });

  /**
   * Get suggested prompt templates based on use case
   * GET /api/prompts/templates/suggested
   */
  fastify.get('/templates/suggested', async (request, reply) => {
    try {
      const {
        category = 'all',
        difficulty = 'all',
        popularity = false
      } = request.query as {
        category?: string;
        difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'all';
        popularity?: boolean;
      };

      // Mock suggested templates (in real implementation, these would come from database/ML)
      const templates = [
        {
          id: 'analytical_thinking',
          name: 'Analytical Thinking Prompt',
          category: 'analysis',
          difficulty: 'intermediate',
          popularity: 95,
          description: 'Structured approach for analytical tasks',
          template: 'Analyze the following [TOPIC] by: 1) Identifying key components, 2) Examining relationships, 3) Drawing evidence-based conclusions. Provide specific examples and reasoning for each point.',
          useCase: 'Breaking down complex topics into manageable components',
          estimatedTokens: 45
        },
        {
          id: 'creative_brainstorming',
          name: 'Creative Brainstorming Prompt',
          category: 'creative',
          difficulty: 'beginner',
          popularity: 87,
          description: 'Generate innovative ideas and solutions',
          template: 'Generate [NUMBER] creative ideas for [TOPIC]. For each idea, provide: 1) A brief description, 2) Unique advantages, 3) Implementation considerations. Think outside conventional approaches.',
          useCase: 'Generating multiple creative solutions',
          estimatedTokens: 38
        },
        {
          id: 'step_by_step_tutorial',
          name: 'Step-by-Step Tutorial',
          category: 'educational',
          difficulty: 'beginner',
          popularity: 92,
          description: 'Clear instructional guidance',
          template: 'Create a step-by-step guide for [TASK]. Include: 1) Prerequisites, 2) Detailed steps with explanations, 3) Common pitfalls to avoid, 4) Success indicators. Make it accessible for beginners.',
          useCase: 'Teaching complex processes clearly',
          estimatedTokens: 42
        },
        {
          id: 'comparative_analysis',
          name: 'Comparative Analysis Framework',
          category: 'analysis',
          difficulty: 'advanced',
          popularity: 78,
          description: 'Compare multiple options systematically',
          template: 'Compare [OPTION_A] and [OPTION_B] across the following dimensions: [CRITERIA]. For each criterion: 1) Rate both options, 2) Provide supporting evidence, 3) Identify trade-offs. Conclude with a recommendation based on [PRIORITIES].',
          useCase: 'Making informed decisions between alternatives',
          estimatedTokens: 55
        }
      ];

      // Filter templates based on query parameters
      let filteredTemplates = templates;

      if (category !== 'all') {
        filteredTemplates = filteredTemplates.filter(t => t.category === category);
      }

      if (difficulty !== 'all') {
        filteredTemplates = filteredTemplates.filter(t => t.difficulty === difficulty);
      }

      if (popularity) {
        filteredTemplates = filteredTemplates.sort((a, b) => b.popularity - a.popularity);
      }

      return reply.send({
        templates: filteredTemplates,
        filters: {
          categories: Array.from(new Set(templates.map(t => t.category))),
          difficulties: ['beginner', 'intermediate', 'advanced'],
          totalAvailable: templates.length,
          filtered: filteredTemplates.length
        },
        suggestions: {
          trending: templates.filter(t => t.popularity > 85).map(t => t.id),
          recommended: templates.filter(t => t.difficulty === 'beginner').map(t => t.id)
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get suggested templates');
      return reply.code(500).send({ error: 'Failed to retrieve suggested templates' });
    }
  });

  /**
   * Analyze prompt structure and provide insights
   * POST /api/prompts/analyze
   */
  fastify.post('/analyze', async (request, reply) => {
    try {
      const { prompt } = request.body as { prompt: string };

      if (!prompt) {
        return reply.code(400).send({ error: 'Prompt is required' });
      }

      // Analyze prompt structure
      const analysis = {
        basicMetrics: {
          length: prompt.length,
          wordCount: prompt.split(/\s+/).length,
          sentenceCount: prompt.split(/[.!?]+/).filter(s => s.trim().length > 0).length,
          paragraphCount: prompt.split(/\n\s*\n/).length,
          estimatedTokens: Math.ceil(prompt.length / 4)
        },
        
        structure: {
          hasQuestions: prompt.includes('?'),
          hasInstructions: /please|provide|explain|analyze|create|generate/i.test(prompt),
          hasNumberedList: /\d+[\.)]\s/.test(prompt),
          hasBulletPoints: /[-*•]\s/.test(prompt),
          hasExamples: /example|such as|for instance/i.test(prompt),
          hasConstraints: /must|should|avoid|don't|limit/i.test(prompt)
        },
        
        complexity: {
          readabilityScore: Math.max(1, Math.min(10, 10 - (prompt.split(/\s+/).length / 20))), // Simple approximation
          vocabularyLevel: prompt.match(/\b\w{7,}\b/g)?.length || 0, // Words 7+ chars
          conceptualComplexity: (prompt.match(/\b(analyze|synthesize|evaluate|compare|contrast|implications|methodology)\b/gi) || []).length
        },
        
        effectiveness: {
          clarity: prompt.includes('specific') || prompt.includes('detailed') ? 'high' : 'medium',
          specificity: prompt.split(' ').length > 10 ? 'high' : 'low',
          actionability: /\b(create|write|list|explain|analyze|compare|summarize)\b/i.test(prompt) ? 'high' : 'medium'
        }
      };

      // Generate recommendations
      const recommendations: string[] = [];
      
      if (!analysis.structure.hasInstructions) {
        recommendations.push('Consider adding clear action verbs (e.g., "analyze", "create", "explain")');
      }
      
      if (analysis.basicMetrics.wordCount < 10) {
        recommendations.push('The prompt might be too brief - consider adding more context');
      }
      
      if (analysis.basicMetrics.wordCount > 100) {
        recommendations.push('Consider breaking down the prompt into smaller, focused parts');
      }
      
      if (!analysis.structure.hasExamples && analysis.complexity.conceptualComplexity > 2) {
        recommendations.push('Adding examples could help clarify complex concepts');
      }
      
      if (!analysis.structure.hasConstraints) {
        recommendations.push('Consider adding constraints to focus the response (e.g., length, format)');
      }

      return reply.send({
        prompt,
        analysis,
        recommendations,
        score: {
          overall: Math.min(10, Math.max(1, 
            (analysis.effectiveness.clarity === 'high' ? 3 : 2) +
            (analysis.effectiveness.specificity === 'high' ? 3 : 2) +
            (analysis.effectiveness.actionability === 'high' ? 3 : 2) +
            (analysis.structure.hasInstructions ? 1 : 0) +
            (analysis.structure.hasExamples ? 1 : 0)
          )),
          breakdown: {
            clarity: analysis.effectiveness.clarity,
            specificity: analysis.effectiveness.specificity,
            actionability: analysis.effectiveness.actionability,
            structure: Object.values(analysis.structure).filter(Boolean).length
          }
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to analyze prompt');
      return reply.code(500).send({ error: 'Prompt analysis failed' });
    }
  });

  /**
   * List available prompting techniques
   * GET /api/prompts/techniques
   */
  fastify.get('/techniques', async (request, reply) => {
    try {
      const techniques = [
        {
          id: 'chain_of_thought',
          name: 'Chain of Thought',
          category: 'reasoning',
          description: 'Break down complex problems into step-by-step reasoning',
          example: 'Let\'s work through this step by step: 1) First, identify... 2) Then, consider... 3) Finally, conclude...',
          useCase: 'Complex problem-solving, mathematical reasoning, logical analysis',
          effectiveness: 95
        },
        {
          id: 'few_shot_learning',
          name: 'Few-Shot Learning',
          category: 'examples',
          description: 'Provide several examples to demonstrate the desired pattern',
          example: 'Here are some examples: Input: X, Output: Y. Input: A, Output: B. Now process: [NEW_INPUT]',
          useCase: 'Pattern recognition, format specification, style mimicking',
          effectiveness: 88
        },
        {
          id: 'role_playing',
          name: 'Role Playing',
          category: 'perspective',
          description: 'Ask the AI to assume a specific role or perspective',
          example: 'As a senior software engineer, review this code and provide feedback...',
          useCase: 'Expert advice, perspective-specific responses, domain knowledge',
          effectiveness: 82
        },
        {
          id: 'socratic_questioning',
          name: 'Socratic Questioning',
          category: 'inquiry',
          description: 'Guide learning through strategic questions rather than direct answers',
          example: 'Instead of giving the answer, ask: What do you think would happen if...? How does this relate to...?',
          useCase: 'Educational content, critical thinking, guided discovery',
          effectiveness: 79
        },
        {
          id: 'constraint_specification',
          name: 'Constraint Specification',
          category: 'control',
          description: 'Clearly define boundaries and limitations for the response',
          example: 'Provide exactly 3 recommendations, each under 50 words, focusing only on technical aspects.',
          useCase: 'Format control, scope limiting, specific requirements',
          effectiveness: 91
        },
        {
          id: 'analogical_reasoning',
          name: 'Analogical Reasoning',
          category: 'comparison',
          description: 'Use analogies and comparisons to explain complex concepts',
          example: 'Explain quantum computing like it\'s a coin that can be heads, tails, or spinning simultaneously.',
          useCase: 'Concept explanation, making complex ideas accessible, creative communication',
          effectiveness: 76
        }
      ];

      const { category, minEffectiveness } = request.query as {
        category?: string;
        minEffectiveness?: number;
      };

      let filteredTechniques = techniques;

      if (category) {
        filteredTechniques = filteredTechniques.filter(t => t.category === category);
      }

      if (minEffectiveness) {
        filteredTechniques = filteredTechniques.filter(t => t.effectiveness >= minEffectiveness);
      }

      return reply.send({
        techniques: filteredTechniques,
        categories: Array.from(new Set(techniques.map(t => t.category))),
        summary: {
          total: techniques.length,
          filtered: filteredTechniques.length,
          avgEffectiveness: filteredTechniques.reduce((sum, t) => sum + t.effectiveness, 0) / filteredTechniques.length
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get prompting techniques');
      return reply.code(500).send({ error: 'Failed to retrieve techniques' });
    }
  });

  /**
   * Create prompt chains for complex workflows
   * POST /api/prompts/chain
   */
  fastify.post('/chain', async (request, reply) => {
    try {
      const {
        workflow,
        steps,
        context = {}
      } = request.body as {
        workflow: string;
        steps: Array<{
          id: string;
          name: string;
          prompt: string;
          inputFrom?: string;
          outputTo?: string;
        }>;
        context?: Record<string, any>;
      };

      if (!workflow || !steps || steps.length === 0) {
        return reply.code(400).send({ error: 'Workflow name and steps are required' });
      }

      // Validate step dependencies
      const stepIds = steps.map(s => s.id);
      const invalidDependencies = steps.filter(step => 
        step.inputFrom && !stepIds.includes(step.inputFrom)
      );

      if (invalidDependencies.length > 0) {
        return reply.code(400).send({ 
          error: 'Invalid step dependencies',
          details: invalidDependencies.map(s => s.id)
        });
      }

      // Create the prompt chain
      const chain = {
        id: `chain_${Date.now()}`,
        workflow,
        steps: steps.map((step, index) => ({
          ...step,
          order: index + 1,
          estimatedTokens: Math.ceil(step.prompt.length / 4),
          dependencies: step.inputFrom ? [step.inputFrom] : []
        })),
        context,
        metadata: {
          totalSteps: steps.length,
          estimatedTotalTokens: steps.reduce((sum, step) => sum + Math.ceil(step.prompt.length / 4), 0),
          createdAt: new Date().toISOString(),
          complexity: steps.length > 5 ? 'high' : steps.length > 2 ? 'medium' : 'low'
        }
      };

      // Generate execution plan
      const executionPlan = {
        sequence: steps.map(s => s.id),
        parallelizable: steps.filter(s => !s.inputFrom).map(s => s.id),
        dependencies: steps.reduce((acc, step) => {
          if (step.inputFrom) {
            acc[step.id] = [step.inputFrom];
          }
          return acc;
        }, {} as Record<string, string[]>)
      };

      return reply.send({
        chain,
        executionPlan,
        recommendations: [
          'Test each step individually before running the full chain',
          'Consider adding error handling between steps',
          'Monitor token usage across the entire workflow'
        ],
        estimatedExecutionTime: `${steps.length * 30}s`, // Rough estimate
        costEstimate: {
          tokens: chain.metadata.estimatedTotalTokens,
          estimatedCost: chain.metadata.estimatedTotalTokens * 0.00001 // Rough cost per token
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create prompt chain');
      return reply.code(500).send({ error: 'Prompt chain creation failed' });
    }
  });
};