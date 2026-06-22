import React, { useRef, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import * as THREE from 'three'
import { useTheme } from '../contexts/ThemeContext'

// Metaball shader for lava lamp effect
const vertexShader = `
  varying vec3 vPosition;
  varying vec3 vNormal;

  void main() {
    vPosition = position;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float time;
  uniform vec3 color1;
  uniform vec3 color2;
  varying vec3 vPosition;
  varying vec3 vNormal;

  void main() {
    float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    vec3 color = mix(color1, color2, fresnel + sin(time + vPosition.y * 2.0) * 0.1);
    float alpha = 0.15 + fresnel * 0.3;
    gl_FragColor = vec4(color, alpha);
  }
`

function Metaball({ position, scale, speed = 1, color1, color2 }) {
  const meshRef = useRef()
  const materialRef = useRef()

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * speed) * 0.5
      meshRef.current.position.x = position[0] + Math.cos(state.clock.elapsedTime * speed * 0.7) * 0.3
      meshRef.current.rotation.x += 0.01 * speed
      meshRef.current.rotation.y += 0.005 * speed
    }
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = state.clock.elapsedTime
      // Update colors every frame to ensure they're current
      materialRef.current.uniforms.color1.value.set(color1)
      materialRef.current.uniforms.color2.value.set(color2)
    }
  })

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <mesh ref={meshRef} position={position} scale={scale}>
        <sphereGeometry args={[1, 32, 32]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          uniforms={{
            time: { value: 0 },
            color1: { value: new THREE.Color(color1) },
            color2: { value: new THREE.Color(color2) },
          }}
        />
      </mesh>
    </Float>
  )
}

Metaball.propTypes = {
  position: PropTypes.arrayOf(PropTypes.number).isRequired,
  scale: PropTypes.number,
  speed: PropTypes.number,
  color1: PropTypes.string,
  color2: PropTypes.string,
}

function Scene() {
  const { viewport } = useThree()
  // theme-allow: brand signal-orange / signal-soft snapshots for the WebGL
  // material color (3D shader needs resolved colors; derived from the accent).
  const [lavaColor1, setLavaColor1] = useState('#FF5722')
  const [lavaColor2, setLavaColor2] = useState('#FFB87E')

  // Update colors from CSS variables
  useEffect(() => {
    const updateColors = () => {
      const root = document.documentElement;
      const accent = getComputedStyle(root).getPropertyValue('--color-accent').trim();
      const color1 = getComputedStyle(root).getPropertyValue('--lava-color-1').trim() || accent || '#FF5722';
      const color2 = getComputedStyle(root).getPropertyValue('--lava-color-2').trim() || '#FFB87E';

      // Only update if colors actually changed
      if (color1 !== lavaColor1 || color2 !== lavaColor2) {
        setLavaColor1(color1);
        setLavaColor2(color2);
      }
    };

    // Initial update
    updateColors();

    // Listen for changes with polling as backup
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style']
    });

    // Polling backup to ensure colors update
    const interval = setInterval(updateColors, 500);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, [lavaColor1, lavaColor2]);

  // Create metaballs positioned around the viewport
  const metaballs = [
    { position: [-viewport.width * 0.3, viewport.height * 0.2, -2], scale: 2.5, speed: 0.8 },
    { position: [viewport.width * 0.4, -viewport.height * 0.3, -3], scale: 3, speed: 0.6 },
    { position: [0, viewport.height * 0.1, -4], scale: 2, speed: 1 },
    { position: [-viewport.width * 0.2, -viewport.height * 0.2, -2.5], scale: 1.8, speed: 0.9 },
    { position: [viewport.width * 0.3, viewport.height * 0.3, -3.5], scale: 2.2, speed: 0.7 },
  ]

  return (
    <>
      {/* Ambient lighting */}
      <ambientLight intensity={0.1} />
      <pointLight position={[10, 10, 10]} intensity={0.5} color={lavaColor1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color={lavaColor2} />

      {/* Metaballs with dynamic colors */}
      {metaballs.map((props, i) => (
        <Metaball key={i} {...props} color1={lavaColor1} color2={lavaColor2} />
      ))}

      {/* Background fog effect — theme-allow: brand terminal-bg snapshot (3D fog needs a resolved color) */}
      <fog attach="fog" args={['#18130C', 5, 15]} />
    </>
  )
}

export default function WebGLBackground() {
  const { resolvedTheme, accentColor } = useTheme();
  const isLightTheme = resolvedTheme === 'light';

  // Force re-render when accent color changes
  const key = accentColor ? accentColor.name : 'default';

  return (
    <div className="webgl-background">
      <Canvas
        key={key} // Force Canvas to remount when accent changes
        camera={{ position: [0, 0, 5], fov: 75 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance"
        }}
      >
        <Scene />
      </Canvas>

      {/* Bumpy glass overlay for texture and readability */}
      <div
        className="absolute inset-0"
        style={{
          background: isLightTheme
            ? 'color-mix(in srgb, var(--color-bg) 85%, transparent)'
            : 'color-mix(in srgb, var(--color-shadow) 65%, transparent)',
          backdropFilter: 'blur(80px) saturate(150%)',
          WebkitBackdropFilter: 'blur(80px) saturate(150%)',
        }}
      >
        {/* Light spots and gradient overlays */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 20% 30%, rgba(139, 92, 246, 0.1) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 70%, rgba(59, 130, 246, 0.1) 0%, transparent 50%),
              radial-gradient(ellipse at 50% 50%, rgba(6, 182, 212, 0.05) 0%, transparent 70%)
            `,
            filter: 'blur(40px)',
            mixBlendMode: 'screen'
          }}
        />

        {/* Noise texture for glass effect */}
        <div
          className="absolute inset-0 opacity-15"
          style={{
            mixBlendMode: 'overlay',
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '128px 128px',
            filter: 'contrast(120%) brightness(120%)'
          }}
        />

        {/* Bumpy glass highlights */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 10% 20%, rgba(255, 255, 255, 0.05) 0%, transparent 20%),
              radial-gradient(circle at 80% 80%, rgba(255, 255, 255, 0.05) 0%, transparent 20%),
              radial-gradient(circle at 40% 60%, rgba(255, 255, 255, 0.03) 0%, transparent 25%),
              radial-gradient(circle at 90% 10%, rgba(255, 255, 255, 0.03) 0%, transparent 25%),
              radial-gradient(circle at 20% 90%, rgba(255, 255, 255, 0.04) 0%, transparent 20%)
            `,
            filter: 'blur(1px)',
            mixBlendMode: 'soft-light'
          }}
        />

        {/* Subtle pattern overlay */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              repeating-conic-gradient(from 0deg at 50% 50%,
                rgba(255, 255, 255, 0.01) 0deg,
                transparent 1deg,
                transparent 2deg,
                rgba(255, 255, 255, 0.01) 3deg)
            `,
            backgroundSize: '60px 60px',
            opacity: 0.5,
            mixBlendMode: 'overlay'
          }}
        />
      </div>

      {/* Additional gradient for better text readability at edges */}
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-[var(--color-shadow)]/20 to-[var(--color-shadow)]/40 pointer-events-none" />
    </div>
  )
}