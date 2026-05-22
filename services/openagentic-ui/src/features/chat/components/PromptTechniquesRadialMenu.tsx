/**
 * Gaming-Style Radial Menu for Prompt Techniques
 * Interactive circular menu with tooltips and smooth animations
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Search, Layers, GitBranch, Sparkles, X } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

interface TechniqueConfig {
  id: string;
  name: string;
  shortName: string;
  description: string;
  details: string;
  icon: React.ReactNode;
  color: string;
  gradientFrom: string;
  gradientTo: string;
  active: boolean;
  example?: {
    before: string;
    after: string;
    explanation: string;
  };
}

interface PromptTechniquesRadialMenuProps {
  sessionId?: string;
  size?: 'small' | 'medium' | 'large';
  position?: 'left' | 'right';
}

export const PromptTechniquesRadialMenu: React.FC<PromptTechniquesRadialMenuProps> = ({
  sessionId,
  size = 'small',
  position = 'left'
}) => {
  const { getAuthHeaders } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredTechnique, setHoveredTechnique] = useState<string | null>(null);
  const [activeTechniques, setActiveTechniques] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Radial menu size configurations
  const sizeConfig = {
    small: { radius: 60, buttonSize: 36, iconSize: 16 },
    medium: { radius: 80, buttonSize: 44, iconSize: 20 },
    large: { radius: 100, buttonSize: 52, iconSize: 24 }
  };

  const { radius, buttonSize, iconSize } = sizeConfig[size];

  // Define technique configurations with gaming-style colors
  const techniques: TechniqueConfig[] = [
    {
      id: 'few-shot',
      name: 'Few-Shot Learning',
      shortName: 'Few-Shot',
      description: 'Learn from examples',
      details: 'AI learns from provided examples to understand the format and style you expect',
      icon: <Layers style={{ width: iconSize, height: iconSize }} />,
      color: 'blue',
      gradientFrom: '#3B82F6',
      gradientTo: '#1E40AF',
      active: false,
      example: {
        before: 'How do I create a user?',
        after: 'Based on examples:\n• POST /api/products\n• POST /api/orders\n→ POST /api/users',
        explanation: 'Learns from patterns'
      }
    },
    {
      id: 'react',
      name: 'ReAct Reasoning',
      shortName: 'ReAct',
      description: 'Think step-by-step',
      details: 'AI reasons through problems step-by-step before providing answers',
      icon: <Brain style={{ width: iconSize, height: iconSize }} />,
      color: 'purple',
      gradientFrom: '#A855F7',
      gradientTo: '#6B21A8',
      active: false,
      example: {
        before: 'What\'s 15% of $240?',
        after: 'Step 1: 15% = 0.15\nStep 2: $240 × 0.15\n→ Answer: $36',
        explanation: 'Shows reasoning'
      }
    },
    {
      id: 'self-consistency',
      name: 'Self-Consistency',
      shortName: 'Consistency',
      description: 'Multiple solutions',
      details: 'Generates multiple answers and picks the most consistent one',
      icon: <GitBranch style={{ width: iconSize, height: iconSize }} />,
      color: 'green',
      gradientFrom: '#22C55E',
      gradientTo: '#047857',
      active: false,
      example: {
        before: 'Capital of Australia?',
        after: 'Checking multiple sources...\n✓ Canberra (not Sydney)',
        explanation: 'Consensus answer'
      }
    },
    {
      id: 'rag',
      name: 'RAG Enhancement',
      shortName: 'RAG',
      description: 'Search knowledge',
      details: 'Searches knowledge base for relevant information before answering',
      icon: <Search style={{ width: iconSize, height: iconSize }} />,
      color: 'orange',
      gradientFrom: '#F97316',
      gradientTo: '#C2410C',
      active: false,
      example: {
        before: 'Handle auth errors?',
        after: 'From docs:\n• 401: Token expired\n• 403: Check permissions',
        explanation: 'Uses knowledge base'
      }
    }
  ];

  // Calculate positions for radial layout
  const calculatePosition = (index: number, total: number) => {
    const angle = (index * (360 / total) - 90) * (Math.PI / 180);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return { x, y };
  };

  // Fetch active techniques
  useEffect(() => {
    const fetchActiveTechniques = async () => {
      if (!sessionId) return;
      
      setLoading(true);
      try {
        const headers = await getAuthHeaders();
        const response = await fetch(apiEndpoint('/admin/prompting/settings'), { headers });

        if (response.ok) {
          const data = await response.json();
          const active = new Set<string>();
          
          if (data.fewShotEnabled) active.add('few-shot');
          if (data.reactEnabled) active.add('react');
          if (data.selfConsistencyEnabled) active.add('self-consistency');
          if (data.ragEnabled) active.add('rag');
          
          setActiveTechniques(active);
        }
      } catch (error) {
        console.error('Failed to fetch prompting techniques:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchActiveTechniques();
  }, [sessionId]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeTechniquesList = techniques.filter(t => activeTechniques.has(t.id));
  
  // Always show the button so users can activate techniques
  // Previously this was hiding the entire menu when no techniques were active

  return (
    <div 
      ref={menuRef}
      className={`relative ${position === 'right' ? 'ml-auto' : ''}`}
      style={{ width: buttonSize, height: buttonSize }}
    >
      {/* Main Toggle Button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          relative z-20 rounded-full p-2 shadow-lg
          transition-all duration-150
          ${isOpen ? 'scale-90' : 'hover:scale-105'}
          ${!isOpen ? 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700' : ''}
        `}
        style={{
          width: buttonSize,
          height: buttonSize,
          background: isOpen
            ? 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primaryLight) 100%)'
            : undefined,
          border: '2px solid var(--color-border)'
        }}
        whileHover={{
          boxShadow: '0 0 20px color-mix(in srgb, var(--color-primary) 50%, transparent)',
          borderColor: 'var(--color-primary)'
        }}
        whileTap={{ scale: 0.95 }}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <X style={{ color: 'var(--color-text)', width: iconSize, height: iconSize }} />
            </motion.div>
          ) : (
            <motion.div
              key="sparkles"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative"
            >
              <Sparkles className="text-blue-500 light:text-blue-600" style={{ width: iconSize, height: iconSize }} />
              {activeTechniquesList.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Radial Menu Items */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Background blur effect */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute inset-0 rounded-full"
              style={{
                width: radius * 2.5,
                height: radius * 2.5,
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 8%, transparent) 0%, transparent 70%)',
                pointerEvents: 'none'
              }}
            />

            {/* Connection lines */}
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{
                width: radius * 2.5,
                height: radius * 2.5,
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)'
              }}
            >
              {techniques.map((technique, index) => {
                const pos = calculatePosition(index, techniques.length);
                return (
                  <motion.line
                    key={technique.id}
                    x1={radius * 1.25}
                    y1={radius * 1.25}
                    x2={radius * 1.25 + pos.x}
                    y2={radius * 1.25 + pos.y}
                    stroke={hoveredTechnique === technique.id ? technique.gradientFrom : 'var(--color-border)'}
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.5 }}
                    exit={{ pathLength: 0, opacity: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                  />
                );
              })}
            </svg>

            {/* Menu Items */}
            {techniques.map((technique, index) => {
              const pos = calculatePosition(index, techniques.length);
              const isHovered = hoveredTechnique === technique.id;

              return (
                <motion.div
                  key={technique.id}
                  className="absolute z-10"
                  initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                  animate={{ 
                    opacity: 1, 
                    scale: 1, 
                    x: pos.x, 
                    y: pos.y 
                  }}
                  exit={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                  transition={{ 
                    type: "spring",
                    stiffness: 500,
                    damping: 25,
                    delay: index * 0.05 
                  }}
                  style={{
                    left: buttonSize / 2 - buttonSize / 2,
                    top: buttonSize / 2 - buttonSize / 2
                  }}
                >
                  <motion.button
                    className="relative rounded-full shadow-xl transition-all duration-150"
                    style={{
                      width: buttonSize,
                      height: buttonSize,
                      background: `linear-gradient(135deg, ${technique.gradientFrom} 0%, ${technique.gradientTo} 100%)`,
                      border: `2px solid ${isHovered ? '#fff' : 'transparent'}`
                    }}
                    onMouseEnter={() => setHoveredTechnique(technique.id)}
                    onMouseLeave={() => setHoveredTechnique(null)}
                    whileHover={{ 
                      scale: 1.2,
                      boxShadow: `0 0 30px ${technique.gradientFrom}`,
                      zIndex: 20
                    }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <div 
                    className="flex items-center justify-center w-full h-full"
                    style={{ color: 'var(--color-text)' }}>
                      {technique.icon}
                    </div>

                    {/* Pulse animation for active state */}
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: `radial-gradient(circle, ${technique.gradientFrom}40 0%, transparent 70%)`
                      }}
                      animate={{
                        scale: [1, 1.5, 1],
                        opacity: [0.5, 0, 0.5]
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    />
                  </motion.button>

                  {/* Tooltip */}
                  <AnimatePresence>
                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.9 }}
                        className={`
                          absolute z-30 w-64 p-4 rounded-lg shadow-2xl
                          bg-white dark:bg-gray-900
                          ${position === 'left' ? 'left-full ml-3' : 'right-full mr-3'}
                          ${index < activeTechniquesList.length / 2 ? 'top-0' : 'bottom-0'}
                        `}
                        style={{
                          border: `1px solid ${technique.gradientFrom}40`,
                        }}
                      >
                        {/* Header */}
                        <div className="flex items-center gap-2 mb-2">
                          <div 
                            className="p-1.5 rounded-lg"
                            style={{ 
                              background: `linear-gradient(135deg, ${technique.gradientFrom} 0%, ${technique.gradientTo} 100%)` 
                            }}
                          >
                            <div style={{ color: 'var(--color-text)' }}>
                              {React.cloneElement(technique.icon as React.ReactElement, { 
                                style: { width: 16, height: 16 } 
                              })}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-bold text-sm text-text-primary">
                              {technique.name}
                            </h4>
                            <p className="text-xs text-text-muted">
                              {technique.description}
                            </p>
                          </div>
                        </div>

                        {/* Details */}
                        <p className="text-xs mb-3 text-text-secondary">
                          {technique.details}
                        </p>

                        {/* Example */}
                        {technique.example && (
                          <div className={`
                            p-2 rounded text-xs space-y-1
                            bg-bg-tertiary
                          `}>
                            <div className="text-text-muted">
                              <span className="font-semibold">Example:</span> {technique.example.explanation}
                            </div>
                          </div>
                        )}

                        {/* Status indicator */}
                        <div 
                        className="flex items-center gap-1 mt-2 pt-2 border-t"
                        style={{ borderColor: 'var(--color-borderHover)' }}>
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span className="text-xs text-green-500 light:text-green-600">
                            Active
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </>
        )}
      </AnimatePresence>
    </div>
  );
};