/**
 * ThinkingSphere - Animated Canvas-Based Loading Indicator
 *
 * Beautiful animated sphere with sparkles, rotating arcs, and pulsing effects.
 * Used as a visual indicator when the LLM is processing/thinking.
 * NO emoji - purely canvas-based animation for a professional look.
 */

import React, { memo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ThinkingSphereState = 'connecting' | 'thinking' | 'processing' | 'generating' | 'hidden';

interface ThinkingSphereProps {
  state: ThinkingSphereState;
  size?: number;
  onTransitionEnd?: () => void;
}

export const ThinkingSphere: React.FC<ThinkingSphereProps> = memo(({ state, size = 32, onTransitionEnd }) => {
  const isVisible = state !== 'hidden';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  // Color palettes based on state
  const getColors = () => {
    switch (state) {
      case 'connecting':
        return [
          { r: 251, g: 191, b: 36 },  // Amber
          { r: 245, g: 158, b: 11 },  // Orange
          { r: 234, g: 88, b: 12 },   // Dark orange
        ];
      case 'thinking':
        return [
          { r: 139, g: 92, b: 246 },  // Purple
          { r: 59, g: 130, b: 246 },  // Blue
          { r: 236, g: 72, b: 153 },  // Pink
        ];
      case 'processing':
        return [
          { r: 59, g: 130, b: 246 },  // Blue
          { r: 34, g: 211, b: 238 },  // Cyan
          { r: 96, g: 165, b: 250 },  // Light blue
        ];
      case 'generating':
        return [
          { r: 16, g: 185, b: 129 },  // Emerald
          { r: 34, g: 211, b: 238 },  // Cyan
          { r: 59, g: 130, b: 246 },  // Blue
        ];
      default:
        return [
          { r: 139, g: 92, b: 246 },  // Purple
          { r: 59, g: 130, b: 246 },  // Blue
          { r: 236, g: 72, b: 153 },  // Pink
        ];
    }
  };

  useEffect(() => {
    if (!isVisible) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const canvasSize = size * 2;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    ctx.scale(dpr, dpr);

    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    const globeRadius = (canvasSize / 2) * 0.75;

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

    const colors = getColors();
    const sparkles: Sparkle[] = [];

    for (let i = 0; i < 12; i++) {
      sparkles.push({
        theta: Math.random() * Math.PI * 2,
        phi: Math.random() * Math.PI,
        radius: Math.random() * globeRadius * 0.8,
        speed: 0.015 + Math.random() * 0.02,
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

      ctx.clearRect(0, 0, canvasSize, canvasSize);

      // Active animation
      time += 0.016;
      rotation += 0.025;

      const pulse = 0.92 + Math.sin(time * 2.5) * 0.08;
      const currentRadius = globeRadius * pulse;

      const currentColors = getColors();
      const primaryColor = currentColors[0];
      const secondaryColor = currentColors[1];

      // Outer glow
      const outerGlow = ctx.createRadialGradient(
        centerX, centerY, currentRadius * 0.5,
        centerX, centerY, currentRadius * 1.3
      );
      outerGlow.addColorStop(0, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0)`);
      outerGlow.addColorStop(0.7, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.1)`);
      outerGlow.addColorStop(1, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0)`);
      ctx.fillStyle = outerGlow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius * 1.3, 0, Math.PI * 2);
      ctx.fill();

      // Core gradient sphere
      const globeGradient = ctx.createRadialGradient(
        centerX - currentRadius * 0.2, centerY - currentRadius * 0.2, currentRadius * 0.1,
        centerX, centerY, currentRadius
      );
      globeGradient.addColorStop(0, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.3)`);
      globeGradient.addColorStop(0.5, `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.2)`);
      globeGradient.addColorStop(1, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.35)`);

      ctx.fillStyle = globeGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.fill();

      // Rotating arc 1 (main)
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotation);
      ctx.strokeStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.8)`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius * 0.85, 0, Math.PI * 0.7);
      ctx.stroke();
      ctx.restore();

      // Rotating arc 2 (counter-rotate)
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(-rotation * 0.7);
      ctx.strokeStyle = `rgba(${secondaryColor.r}, ${secondaryColor.g}, ${secondaryColor.b}, 0.6)`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius * 0.7, Math.PI * 0.5, Math.PI * 1.2);
      ctx.stroke();
      ctx.restore();

      // Rotating arc 3 (fast, small)
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotation * 1.5);
      ctx.strokeStyle = `rgba(${currentColors[2].r}, ${currentColors[2].g}, ${currentColors[2].b}, 0.5)`;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius * 0.55, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      ctx.restore();

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

        sparkle.life += 0.025;
        if (sparkle.life > sparkle.maxLife) {
          sparkle.life = 0;
          sparkle.color = currentColors[Math.floor(Math.random() * currentColors.length)];
        }

        const twinkle = Math.sin(sparkle.life / sparkle.maxLife * Math.PI);
        const alpha = twinkle * (0.4 + depthFactor * 0.6);

        const c = sparkle.color;
        ctx.shadowBlur = sparkleSize * 4;
        ctx.shadowColor = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha * 0.8})`;
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x2d, y2d, sparkleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Outer ring with pulse
      const ringAlpha = 0.35 + Math.sin(time * 3) * 0.15;
      ctx.strokeStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${ringAlpha})`;
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
  }, [isVisible, state, size]);

  return (
    <AnimatePresence onExitComplete={onTransitionEnd}>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.3 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            verticalAlign: 'middle',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: size * 2,
              height: size * 2,
              display: 'block',
              flexShrink: 0
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
});

ThinkingSphere.displayName = 'ThinkingSphere';
export default ThinkingSphere;
