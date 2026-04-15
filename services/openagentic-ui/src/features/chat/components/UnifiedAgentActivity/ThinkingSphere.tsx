/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * ThinkingSphere - Animated 3D sphere for thinking state
 *
 * Canvas-based animated sphere with sparkles.
 * Shows different states: thinking (animated), complete (checkmark), error (red).
 *
 * @copyright 2026 Gnomus.ai
 */

import React, { useEffect, useRef } from 'react';
import { AgentPhase } from './types';

interface ThinkingSphereProps {
  phase: AgentPhase;
  size?: number;
  className?: string;
}

export const ThinkingSphere: React.FC<ThinkingSphereProps> = ({
  phase,
  size = 40,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  const isActive = phase === 'thinking' || phase === 'tool_calling' || phase === 'tool_executing' || phase === 'synthesizing';
  const isComplete = phase === 'complete';
  const isError = phase === 'idle'; // Could add error phase

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * 2 * dpr;
    canvas.height = size * 2 * dpr;
    ctx.scale(dpr, dpr);

    const centerX = size;
    const centerY = size;
    const globeRadius = size * 0.75;

    // Color palettes
    const thinkingColors = [
      { r: 139, g: 92, b: 246 },  // Purple
      { r: 59, g: 130, b: 246 },  // Blue
      { r: 236, g: 72, b: 153 },  // Pink
    ];

    const toolColors = [
      { r: 59, g: 130, b: 246 },  // Blue
      { r: 34, g: 211, b: 238 },  // Cyan
      { r: 96, g: 165, b: 250 },  // Light blue
    ];

    const synthesisColors = [
      { r: 16, g: 185, b: 129 },  // Emerald
      { r: 34, g: 211, b: 238 },  // Cyan
      { r: 59, g: 130, b: 246 },  // Blue
    ];

    const getColors = () => {
      if (phase === 'tool_executing' || phase === 'tool_calling') return toolColors;
      if (phase === 'synthesizing') return synthesisColors;
      return thinkingColors;
    };

    // Sparkle particles
    interface Sparkle {
      theta: number;
      phi: number;
      radius: number;
      speed: number;
      size: number;
      life: number;
      maxLife: number;
      color: { r: number; g: number; b: number };
    }

    const sparkles: Sparkle[] = [];
    const colors = getColors();

    for (let i = 0; i < 15; i++) {
      sparkles.push({
        theta: Math.random() * Math.PI * 2,
        phi: Math.random() * Math.PI,
        radius: Math.random() * globeRadius * 0.8,
        speed: 0.01 + Math.random() * 0.02,
        size: 1 + Math.random() * 2,
        life: Math.random(),
        maxLife: 0.5 + Math.random() * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }

    let time = 0;
    let rotation = 0;

    const animate = () => {
      if (!ctx) return;

      ctx.clearRect(0, 0, size * 2, size * 2);

      // Complete state - static green
      if (isComplete) {
        const gradient = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, globeRadius);
        gradient.addColorStop(0, 'rgba(34, 197, 94, 0.15)');
        gradient.addColorStop(1, 'rgba(34, 197, 94, 0.3)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, globeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Checkmark
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(centerX - 10, centerY);
        ctx.lineTo(centerX - 3, centerY + 7);
        ctx.lineTo(centerX + 10, centerY - 7);
        ctx.stroke();
        return;
      }

      // Idle state - dim
      if (!isActive) {
        const gradient = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, globeRadius);
        gradient.addColorStop(0, 'rgba(100, 116, 139, 0.1)');
        gradient.addColorStop(1, 'rgba(100, 116, 139, 0.2)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, globeRadius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      // Active animation
      time += 0.016;
      rotation += 0.02;

      const pulse = 0.92 + Math.sin(time * 2) * 0.08;
      const currentRadius = globeRadius * pulse;

      // Core glow
      const currentColors = getColors();
      const primaryColor = currentColors[0];
      const secondaryColor = currentColors[1];

      const globeGradient = ctx.createRadialGradient(
        centerX, centerY, currentRadius * 0.2,
        centerX, centerY, currentRadius
      );
      globeGradient.addColorStop(0, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.2)`);
      globeGradient.addColorStop(0.6, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.15)`);
      globeGradient.addColorStop(1, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.3)`);

      ctx.fillStyle = globeGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.fill();

      // Sparkles
      sparkles.forEach((sparkle) => {
        sparkle.theta += sparkle.speed;

        const x3d = sparkle.radius * Math.sin(sparkle.phi) * Math.cos(sparkle.theta + rotation);
        const y3d = sparkle.radius * Math.sin(sparkle.phi) * Math.sin(sparkle.theta + rotation);
        const z3d = sparkle.radius * Math.cos(sparkle.phi);

        const perspective = 100 / (100 + z3d);
        const x2d = centerX + x3d * perspective;
        const y2d = centerY + y3d * perspective * 0.8;

        const depthFactor = (z3d + globeRadius) / (globeRadius * 2);
        const sparkleSize = sparkle.size * perspective * (0.5 + depthFactor * 0.5);

        sparkle.life += 0.02;
        if (sparkle.life > sparkle.maxLife) {
          sparkle.life = 0;
          sparkle.color = currentColors[Math.floor(Math.random() * currentColors.length)];
        }

        const twinkle = Math.sin(sparkle.life / sparkle.maxLife * Math.PI);
        const alpha = twinkle * (0.5 + depthFactor * 0.5);

        const c = sparkle.color;
        ctx.shadowBlur = sparkleSize * 3;
        ctx.shadowColor = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x2d, y2d, sparkleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Outer ring
      ctx.strokeStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${0.3 + Math.sin(time * 3) * 0.15})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.stroke();

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, size, isActive, isComplete]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: size * 2,
        height: size * 2,
        display: 'block',
        flexShrink: 0
      }}
    />
  );
};

export default ThinkingSphere;
