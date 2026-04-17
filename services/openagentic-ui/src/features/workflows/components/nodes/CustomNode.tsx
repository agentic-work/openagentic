/**
 * CustomNode - n8n-inspired flat card with icon circle, status glows, hover toolbar
 */
/* eslint-disable no-restricted-syntax -- Workflow node styling uses intentional colors */

import React, { memo, useState, useCallback, useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2, Copy, Settings, CheckCircle, XCircle, Clock, AlertCircle, Play,
} from '@/shared/icons';
import { nodeTypeConfigs } from '../../utils/nodeConfigs';
import { getNodeIcon } from './nodeIcons';

// Category color map
const CATEGORY_COLORS: Record<string, string> = {
  trigger: '#ff9800',
  ai: '#7c4dff',
  action: '#00bcd4',
  logic: '#2196f3',
  data: '#2dd4bf',
  approval: '#e91e63',
  agents: '#7c3aed',
  http: '#ff5722',
  code: '#607d8b',
  integration: '#6264A7',
};

// ─── Vendor / brand SVG icons ─────────────────────────────────────────
// Returns { icon, bgColor } if a vendor match is found, null otherwise.
// Uses official brand logo SVG paths for maximum recognizability.
interface VendorIconResult { icon: React.ReactNode; bgColor: string }

export function getVendorIcon(nodeType: string, data: Record<string, any>): VendorIconResult | null {
  const toolName = (data.toolName || data.tool_name || '').toLowerCase();
  const label = (data.label || '').toLowerCase();
  const hint = `${toolName} ${label} ${nodeType}`;
  const s = 18;

  // ── AWS — official smile logo ──
  if (hint.includes('aws') || hint.includes('s3') || hint.includes('ec2') || hint.includes('bedrock') || hint.includes('lambda') || hint.includes('cloudwatch') || hint.includes('sagemaker') || hint.includes('dynamo')) {
    return {
      bgColor: '#232f3e',
      icon: (
        <svg width={s} height={s} viewBox="0 0 256 256">
          <path d="M72.4 170.1c0 3.2.4 5.8 1 8 .7 2.2 1.7 4.6 3.1 7.2a4.1 4.1 0 01.7 2.2c0 1-.6 2-1.9 3l-6.3 4.2c-.9.6-1.8.9-2.6.9-1 0-2-.5-3-1.4a31 31 0 01-3.6-4.7c-1-1.7-2-3.6-3.1-5.9-7.8 9.2-17.6 13.8-29.4 13.8-8.4 0-15.1-2.4-20-7.2s-7.4-11.2-7.4-19.2c0-8.5 3-15.4 9.1-20.6s14.2-7.8 24.5-7.8c3.4 0 6.9.3 10.6.8s7.5 1.3 11.5 2.3v-7.3c0-7.6-1.6-12.9-4.7-16-3.2-3.1-8.6-4.6-16.3-4.6-3.5 0-7.1.4-10.8 1.3s-7.3 2-10.8 3.4a27 27 0 01-3.3 1.3 5.7 5.7 0 01-1.5.2c-1.3 0-2-.9-2-2.8v-5c0-1.4.2-2.5.7-3.2.5-.7 1.4-1.4 2.8-2.1 3.5-1.8 7.7-3.3 12.6-4.5 4.9-1.3 10-1.9 15.5-1.9 11.8 0 20.4 2.7 25.9 8 5.4 5.4 8.2 13.5 8.2 24.4v32.1h.1zM42 185c3.3 0 6.7-.6 10.3-1.8 3.6-1.2 6.8-3.4 9.5-6.4 1.6-1.9 2.8-4 3.4-6.4.6-2.4 1-5.3 1-8.7v-4.2a83 83 0 00-9.2-1.7 76 76 0 00-9.4-.6c-6.7 0-11.6 1.3-14.9 4s-4.9 6.5-4.9 11.5c0 4.7 1.2 8.2 3.7 10.6 2.4 2.5 5.9 3.7 10.5 3.7zm80.8 10.3c-1.7 0-2.8-.3-3.5-1-.7-.6-1.3-1.9-1.8-3.6L96.2 115a17 17 0 01-.7-3.7c0-1.5.7-2.3 2.2-2.3h9.8c1.8 0 3 .3 3.6 1 .7.6 1.2 1.9 1.7 3.6l15 59.1 13.9-59.1c.4-1.8 1-3 1.7-3.6.7-.7 2-1 3.7-1h8c1.8 0 3 .3 3.7 1 .7.7 1.3 1.9 1.7 3.6l14 59.9 15.5-59.9c.5-1.8 1.1-3 1.7-3.6.7-.7 1.9-1 3.6-1h9.3c1.5 0 2.3.7 2.3 2.3 0 .5-.1 1-.2 1.5-.1.6-.3 1.3-.6 2.3L178 190.7c-.5 1.8-1.1 3-1.8 3.6-.7.6-1.9 1-3.5 1h-8.6c-1.7 0-2.9-.3-3.6-1s-1.3-1.9-1.7-3.7l-13.8-57.6-13.7 57.5c-.4 1.8-1 3.1-1.7 3.7-.7.7-2 1-3.7 1h-8.6zm129.3 2.6c-5.2 0-10.4-.6-15.4-1.8-5-1.2-8.9-2.5-11.5-4-1.6-.9-2.7-1.9-3.1-2.8a7.1 7.1 0 01-.6-2.8v-5.2c0-1.9.7-2.8 2.1-2.8a5 5 0 011.6.2l2 1a44 44 0 0019.5 4.5c5.2 0 9.2-.9 12-2.7 2.8-1.8 4.3-4.5 4.3-7.8 0-2.3-.7-4.2-2.2-5.8-1.5-1.6-4.3-3-8.2-4.4l-11.8-3.7c-5.9-1.9-10.3-4.7-13-8.3-2.7-3.5-4.1-7.5-4.1-11.7 0-3.4.7-6.4 2.2-9 1.5-2.6 3.4-4.9 5.9-6.7s5.2-3.2 8.4-4.2a34 34 0 0110.4-1.5c1.8 0 3.7.1 5.6.3 1.8.2 3.5.6 5.2 1 1.6.4 3.1.9 4.5 1.4 1.4.5 2.5 1 3.2 1.5 1.1.6 1.9 1.3 2.3 2s.7 1.6.7 2.9v4.8c0 1.9-.7 2.9-2.1 2.9-.7 0-1.9-.4-3.4-1.1-5.1-2.3-10.8-3.5-17.1-3.5-4.7 0-8.4.7-10.9 2.3-2.5 1.5-3.8 3.9-3.8 7.2 0 2.3.8 4.3 2.4 5.9 1.6 1.6 4.6 3.2 8.9 4.6l11.6 3.6c5.8 1.9 10.1 4.5 12.6 7.9s3.8 7.2 3.8 11.4c0 3.5-.7 6.7-2.1 9.5a22 22 0 01-6 7.2c-2.6 2-5.6 3.4-9.2 4.5-3.7 1.1-7.7 1.7-12 1.7z" fill="#fff"/>
          <path d="M230.6 213.7c-28.2 20.8-69.2 31.9-104.5 31.9-49.4 0-93.9-18.3-127.6-48.7-2.6-2.4-.3-5.6 2.9-3.8 36.4 21.1 81.3 33.9 127.8 33.9 31.3 0 65.8-6.5 97.5-20 4.8-2.1 8.8 3.1 3.9 6.7z" fill="#F90"/>
          <path d="M241.8 200.8c-3.6-4.6-23.8-2.2-32.8-1.1-2.8.3-3.2-2.1-.7-3.8 16.1-11.3 42.5-8 45.5-4.2 3.1 3.8-.8 30.1-15.9 42.7-2.3 1.9-4.5.9-3.5-1.6 3.4-8.5 11-27.4 7.4-32z" fill="#F90"/>
        </svg>
      ),
    };
  }

  // ── Azure — official logo ──
  if (hint.includes('azure') || hint.includes('azure_ad')) {
    return {
      bgColor: '#0078d4',
      icon: (
        <svg width={s} height={s} viewBox="0 0 96 96">
          <path d="M33.3 6.1c7.7-13 28.8-13 36.5 0L95 48c7.7 13-1.9 29.3-17.2 29.3H19.3C4 77.3-5.6 61-2 48L33.3 6.1z" fill="none"/>
          <path d="M34.5 12.7L4 75.2h21.6L56.6 18z" fill="#fff"/>
          <path d="M54.5 32.6L40.3 58.3l24 16.9H91z" fill="#fff" opacity=".8"/>
        </svg>
      ),
    };
  }

  // ── GCP — official cloud logo shape ──
  if (hint.includes('gcp') || hint.includes('google') || hint.includes('vertex') || hint.includes('gemini')) {
    return {
      bgColor: '#4285F4',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24">
          <path d="M14.5 6.5h1.8L18 4.8l.2-1A9.4 9.4 0 004.6 8.2l.9-.1 3.6-.6s.2-.3.3-.3A5.8 5.8 0 0114.5 6.5z" fill="#EA4335"/>
          <path d="M19.6 8.2a9.5 9.5 0 00-2.8-4.4l-2.6 2.6a5.8 5.8 0 012.1 4.6v.6a2.9 2.9 0 010 5.8H12l-.6.6v3.5l.6.6h4.3A6.5 6.5 0 0019.6 8.2z" fill="#4285F4"/>
          <path d="M7.7 22.1h4.3V18.5H7.7a2.9 2.9 0 01-1.2-.3l-.8.3-2.6 2.6-.2.8a6.5 6.5 0 004.8 2.2z" fill="#34A853"/>
          <path d="M7.7 9.2a6.5 6.5 0 00-4.8 10.9l2.8-2.8A2.9 2.9 0 017.7 12a2.9 2.9 0 012-5.1l2.7-2.7A6.5 6.5 0 007.7 9.2z" fill="#FBBC05"/>
        </svg>
      ),
    };
  }

  // ── Kubernetes — official helm wheel ──
  if (hint.includes('k8s') || hint.includes('kubernetes') || hint.includes('kubectl') || hint.includes('helm')) {
    return {
      bgColor: '#326ce5',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M12 1.5a1.4 1.4 0 00-.6.1L4.3 5.3a1.4 1.4 0 00-.7 1v7.4c0 .4.3.8.7 1l7.1 3.7c.4.2.8.2 1.2 0l7.1-3.7c.4-.2.7-.6.7-1V6.3c0-.4-.3-.8-.7-1L12.6 1.6a1.4 1.4 0 00-.6-.1zm0 1.7l6 3.1v6.2l-6 3.1-6-3.1V6.3l6-3.1z"/>
          <circle cx="12" cy="9.5" r="2.2"/>
          <rect x="11.4" y="4" width="1.2" height="3" rx=".6"/>
          <rect x="11.4" y="13" width="1.2" height="3" rx=".6"/>
          <rect x="11.4" y="4" width="1.2" height="3" rx=".6" transform="rotate(60 12 9.5)"/>
          <rect x="11.4" y="4" width="1.2" height="3" rx=".6" transform="rotate(120 12 9.5)"/>
          <rect x="11.4" y="4" width="1.2" height="3" rx=".6" transform="rotate(180 12 9.5)"/>
          <rect x="11.4" y="4" width="1.2" height="3" rx=".6" transform="rotate(240 12 9.5)"/>
          <rect x="11.4" y="4" width="1.2" height="3" rx=".6" transform="rotate(300 12 9.5)"/>
        </svg>
      ),
    };
  }

  // ── GitHub — official Octocat mark ──
  if (hint.includes('github') || hint.includes('git_') || hint.includes('pull_request') || hint.includes('repo')) {
    return {
      bgColor: '#24292f',
      icon: (
        <svg width={s} height={s} viewBox="0 0 98 96" fill="#fff">
          <path fillRule="evenodd" clipRule="evenodd" d="M48.9 0C21.8 0 0 22 0 49.2 0 71 14 89.4 33.4 95.9c2.4.5 3.3-1.1 3.3-2.4 0-1.1 0-4.9-.1-8.9-13.6 3-16.4-5.8-16.4-5.8-2.2-5.7-5.4-7.2-5.4-7.2-4.4-3 .3-3 .3-3 4.9.3 7.5 5 7.5 5 4.3 7.5 11.3 5.3 14.1 4.1.4-3.2 1.7-5.3 3-6.5-10.8-1.2-22.2-5.4-22.2-24.1 0-5.3 1.9-9.7 5-13.1-.5-1.2-2.2-6.2.5-12.9 0 0 4.1-1.3 13.4 5a46 46 0 0124.5 0c9.3-6.3 13.4-5 13.4-5 2.7 6.7 1 11.7.5 12.9 3.1 3.4 5 7.8 5 13.1 0 18.8-11.4 22.9-22.3 24.1 1.8 1.5 3.3 4.5 3.3 9.1 0 6.6-.1 11.9-.1 13.5 0 1.3.9 2.9 3.4 2.4 19.3-6.5 33.2-24.8 33.2-46.5C97.8 22 76 0 48.9 0z"/>
        </svg>
      ),
    };
  }

  // ── Prometheus — official fire logo ──
  if (hint.includes('prometheus') || hint.includes('prom_')) {
    return {
      bgColor: '#e6522c',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm0 22.5c-1.8 0-3.3-.7-3.3-1.5h6.6c0 .8-1.5 1.5-3.3 1.5zm5.5-2.6H6.5v-1.5h11v1.5zm-.1-2.5H6.6c-.1-.1-.2-.2-.2-.3-1.6-1.9-2-3-2.2-3.5.1.1 1.7 1 3.7 1 .3 0 .5 0 .8-.1-.7-.8-1.2-2.1-1.2-3.6 0-2.6 1.4-4.4 1.4-4.4s.1 2.1 1.5 4c.3.4.6.7 1 1 0-.4 0-2.3.8-4.2.7-1.5 1.8-2.7 2-3-.1.4-.3 1.3-.3 2.4 0 2.2.7 3.5 1.4 5 .4-.2.7-.4 1.1-.6 0 0-1.1-1.5-.8-4.1.2-2 1-3 1-3s.4 1 .4 2.5c0 1.8-.3 2.8-.3 2.8s.5.6.8 1.6c.5 1.4.1 3 .1 3 1.3-.3 2.7-.7 3-1l-.1.2c-.3.8-1 2-2.6 4z"/>
        </svg>
      ),
    };
  }

  // ── Grafana Loki — official logo ──
  if (hint.includes('loki') || hint.includes('log_query')) {
    return {
      bgColor: '#f2994a',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H8v-2h3v2zm0-3H8v-2h3v2zm0-3H8V8h3v2zm5 6h-3v-2h3v2zm0-3h-3v-2h3v2zm0-3h-3V8h3v2z"/>
        </svg>
      ),
    };
  }

  // ── Web / SearXNG — globe ──
  if (hint.includes('web_search') || hint.includes('web_fetch') || hint.includes('searxng')) {
    return {
      bgColor: '#0891b2',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="11" cy="11" r="6"/><ellipse cx="11" cy="11" rx="2.5" ry="6"/>
          <line x1="5" y1="11" x2="17" y2="11"/><line x1="17" y1="17" x2="20" y2="20" strokeWidth="2"/>
        </svg>
      ),
    };
  }

  // ── Slack — official 4-color hash mark ──
  if (hint.includes('slack') || nodeType === 'slack_message') {
    return {
      bgColor: '#4a154b',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24">
          <path d="M5.04 15.16a2.06 2.06 0 01-2.06 2.06A2.06 2.06 0 01.92 15.16a2.06 2.06 0 012.06-2.06h2.06v2.06zm1.04 0a2.06 2.06 0 012.06-2.06 2.06 2.06 0 012.06 2.06v5.16a2.06 2.06 0 01-2.06 2.06 2.06 2.06 0 01-2.06-2.06v-5.16z" fill="#E01E5A"/>
          <path d="M8.14 5.04a2.06 2.06 0 01-2.06-2.06A2.06 2.06 0 018.14.92a2.06 2.06 0 012.06 2.06v2.06H8.14zm0 1.04a2.06 2.06 0 012.06 2.06 2.06 2.06 0 01-2.06 2.06H2.98A2.06 2.06 0 01.92 8.14a2.06 2.06 0 012.06-2.06h5.16z" fill="#36C5F0"/>
          <path d="M18.16 8.14a2.06 2.06 0 012.06-2.06 2.06 2.06 0 012.06 2.06 2.06 2.06 0 01-2.06 2.06h-2.06V8.14zm-1.04 0a2.06 2.06 0 01-2.06 2.06 2.06 2.06 0 01-2.06-2.06V2.98A2.06 2.06 0 0115.06.92a2.06 2.06 0 012.06 2.06v5.16z" fill="#2EB67D"/>
          <path d="M15.06 18.16a2.06 2.06 0 012.06 2.06 2.06 2.06 0 01-2.06 2.06 2.06 2.06 0 01-2.06-2.06v-2.06h2.06zm0-1.04a2.06 2.06 0 01-2.06-2.06 2.06 2.06 0 012.06-2.06h5.16a2.06 2.06 0 012.06 2.06 2.06 2.06 0 01-2.06 2.06h-5.16z" fill="#ECB22E"/>
        </svg>
      ),
    };
  }

  // ── Microsoft Teams — official logo ──
  if (hint.includes('teams') || nodeType === 'teams_message') {
    return {
      bgColor: '#6264A7',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M20.6 7.5c.8 0 1.4-.6 1.4-1.4s-.6-1.4-1.4-1.4-1.4.6-1.4 1.4.6 1.4 1.4 1.4zM23 9h-4.8c-.1 0-.2.1-.2.2v5.3c0 1.8-1.2 3.3-2.9 3.8V18.8c0 .1.1.2.2.2H19c2.2 0 4-1.8 4-4V9zm-6.5-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM15 7H7c-.6 0-1 .4-1 1v7.5c0 2.8 2.2 5 5 5s5-2.2 5-5V8c0-.6-.4-1-1-1zm-3.8 8.7h-1.4V11H8V9.8h5v1.3h-1.8v4.6z"/>
        </svg>
      ),
    };
  }

  // ── Microsoft Outlook — official envelope logo ──
  if (hint.includes('outlook') || nodeType === 'outlook_email') {
    return {
      bgColor: '#0078d4',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M22 6v12a1 1 0 01-1 1H9a1 1 0 01-1-1v-1l8-4 6 3V6zm-1-1H9a1 1 0 00-1 1l8 5 6-4V6a1 1 0 00-1-1z"/>
          <path d="M7 8v9H2.5A.5.5 0 012 16.5v-8a.5.5 0 01.5-.5H7z" opacity=".9"/>
          <ellipse cx="4.5" cy="12.5" rx="1.8" ry="2.2" fill="#0078d4"/>
        </svg>
      ),
    };
  }

  // ── PagerDuty — official green logo ──
  if (hint.includes('pagerduty') || hint.includes('pager_duty') || nodeType === 'pagerduty_incident') {
    return {
      bgColor: '#06AC38',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M8 2h5.7c4.2 0 6.8 2.5 6.8 6.3 0 4-2.8 6.5-7 6.5H11V22H8V2zm3 10.3h2.3c2.7 0 4.2-1.3 4.2-3.8s-1.5-3.9-4.1-3.9H11v7.7z"/>
        </svg>
      ),
    };
  }

  // ── ServiceNow — official logo ──
  if (hint.includes('servicenow') || hint.includes('snow') || nodeType === 'servicenow_ticket') {
    return {
      bgColor: '#81B5A1',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 16c-2.6 0-5-1.7-5.8-4.1l2.1-.8c.5 1.5 1.9 2.5 3.7 2.5s3.2-1 3.7-2.5l2.1.8C17 16.3 14.6 18 12 18zm4.8-6.9l-1.5-1.5a1.8 1.8 0 00-2.6 0l-1.4 1.4-1.4-1.4a1.8 1.8 0 00-2.6 0L5.8 11c-.4.4-.4 1 0 1.4l.7.7 1.5-1.5a.6.6 0 01.8 0l1.8 1.8a.6.6 0 00.8 0l1.8-1.8a.6.6 0 01.8 0l1.5 1.5.7-.7c.4-.4.4-1 0-1.3z"/>
        </svg>
      ),
    };
  }

  // ── Jira — official logo ──
  if (hint.includes('jira') || nodeType === 'jira_issue') {
    return {
      bgColor: '#0052CC',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M22.2 11.1L13 1.9 12 .9 4.1 8.8a.7.7 0 000 1l3.5 3.5L12 17.7l7.9-7.9 .3-.3 2-1.4zM12 14.3L9.7 12 12 9.7l2.3 2.3-2.3 2.3z"/>
          <path d="M12 9.7a5 5 0 01-3.5-1.4L4.1 12.7a.7.7 0 000 1L12 21.6l7.9-7.9a.7.7 0 000-1l-4.4-4.4a5 5 0 01-3.5 1.4z" opacity=".7"/>
        </svg>
      ),
    };
  }

  // ── Discord — official logo ──
  if (hint.includes('discord') || nodeType === 'discord_message') {
    return {
      bgColor: '#5865F2',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M19.3 5.3a16.5 16.5 0 00-4.1-1.3.1.1 0 00-.1 0c-.2.3-.4.8-.5 1.1a15.4 15.4 0 00-4.6 0c-.2-.4-.3-.8-.5-1.1a.1.1 0 00-.1 0A16.5 16.5 0 005.2 5.3a.1.1 0 000 0C2.4 9.6 1.6 13.7 2 17.8v0a16.6 16.6 0 005 2.5.1.1 0 00.1 0c.4-.5.7-1.1 1-1.7a.1.1 0 000-.1 10.9 10.9 0 01-1.7-.8.1.1 0 010-.2l.3-.3a11.8 11.8 0 0010.1 0l.4.3a.1.1 0 010 .2 10.2 10.2 0 01-1.7.8.1.1 0 000 .1c.3.6.7 1.2 1.1 1.7a.1.1 0 00.1 0 16.5 16.5 0 005.1-2.5v-.1c.4-4.8-.7-8.9-3-12.5zM8.7 15.2c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2zm7.4 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2c0 1.2-.9 2.2-2 2.2z"/>
        </svg>
      ),
    };
  }

  // ── Email / SMTP — envelope icon ──
  if (hint.includes('email') || hint.includes('smtp') || hint.includes('mail') || nodeType === 'send_email') {
    return {
      bgColor: '#ea4335',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
      ),
    };
  }

  // ── Docker — official whale logo ──
  if (hint.includes('docker') || hint.includes('container')) {
    return {
      bgColor: '#2496ed',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M4.8 11.8h2.5V9.4H4.8v2.4zm3 0h2.4V9.4H7.8v2.4zm0-2.9h2.4V6.5H7.8V9zm3 2.9h2.4V9.4h-2.4v2.4zm0-2.9h2.4V6.5h-2.4V9zm3 2.9h2.4V9.4h-2.4v2.4zm-3-5.8h2.4V3.6h-2.4v2.5zm3 2.9h2.4V6.5h-2.4V9zm3 2.9h2.4V9.4h-2.4v2.4zM24 12s-1.3-2-4-2.2c-.4-1.8-2-3-2-3s-1.7 2.4-.5 4.7c0 0-1.1-.5-2.7-.5H2.6c-.3 1.7-.3 7.4 4.8 10.2C10.5 23 14 23 17 21.6c3.7-1.7 5.5-5 6.2-6.7.6 0 2.8.2 3.2-2.5-.8-.2-2.4-.4-2.4-.4z"/>
        </svg>
      ),
    };
  }

  // ── Terraform — official T logo ──
  if (hint.includes('terraform') || hint.includes('iac')) {
    return {
      bgColor: '#7b42bc',
      icon: (
        <svg width={s} height={s} viewBox="0 0 64 64" fill="#fff">
          <path d="M22.8 9L40 18.9v19.8L22.8 28.8V9z"/>
          <path d="M43 18.9l17.2-9.9v19.8L43 38.7V18.9z"/>
          <path d="M3.8 0L21 9.9v19.8L3.8 19.8V0z"/>
          <path d="M22.8 33.2l17.2 9.9V63l-17.2-9.9V33.2z"/>
        </svg>
      ),
    };
  }

  // ── Redis — official logo ──
  if (hint.includes('redis') || hint.includes('cache')) {
    return {
      bgColor: '#dc382d',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M22.5 13.7c0 1.3-4.7 3.4-10.5 3.4S1.5 15 1.5 13.7c0-1.3 4.7-3.4 10.5-3.4s10.5 2.1 10.5 3.4z" opacity=".4"/>
          <path d="M22.5 10.5c0 1.3-4.7 3.4-10.5 3.4S1.5 11.8 1.5 10.5 6.2 7.1 12 7.1s10.5 2.1 10.5 3.4z" opacity=".7"/>
          <path d="M22.5 7.3c0 1.3-4.7 3.4-10.5 3.4S1.5 8.6 1.5 7.3 6.2 3.9 12 3.9s10.5 2.1 10.5 3.4z"/>
          <path d="M14.5 6.8l-2.5 1-2.5-1L12 5.4l2.5 1.4zm-5.2-.4L7 7.5l3 1.3 2-1.2-2.7-1.2z"/>
        </svg>
      ),
    };
  }

  // ── PostgreSQL — official elephant logo ──
  if (hint.includes('postgres') || hint.includes('pgvector') || hint.includes('database') || hint.includes('sql')) {
    return {
      bgColor: '#336791',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M17.1 3.5c-1-.6-2.3-.8-3.5-.8-1 0-2 .2-2.8.5-.4-.1-.9-.2-1.5-.2-1.6 0-2.9.5-3.8 1.3C4 5.6 3.4 7.5 3.6 10l.2 1.5c.3 1.5.8 2.9 1.4 3.9.8 1.3 1.7 2 2.7 2h.1c.4 0 .8-.2 1.1-.5.3.3.8.5 1.3.5h.1c.5 0 1-.2 1.4-.6.5.5 1.2.8 2 .8 1 0 1.9-.5 2.5-1.3.7.4 1.6.5 2.4.3 1.2-.4 2-1.4 2.4-3l.2-.8c.5-2.3.2-4.3-.5-5.8-.5-1.2-1.6-2.4-3.3-3.5z" fill="#fff"/>
          <path d="M16.3 14.2c-.3 1.2-1 1.8-1.6 2-.6.1-1.2 0-1.6-.3l-.2.4c-.4.7-1 1.1-1.7 1.1-.7 0-1.2-.4-1.5-.9-.2.3-.5.4-.8.5h-.2c-.6 0-1.3-.5-1.9-1.6-.5-.9-1-2.1-1.2-3.5l-.2-1.4c-.2-2.2.3-3.8 1.4-4.8.7-.7 1.7-1 2.9-1h.3c.7 0 1.2.1 1.6.3l.2-.1c.7-.3 1.5-.4 2.3-.4 1 0 2 .2 2.9.7 1.4 1 2.3 2 2.8 3 .6 1.3.8 3 .4 5l-.2.8z" fill="#336791"/>
        </svg>
      ),
    };
  }

  // ── Milvus — vector DB logo ──
  if (hint.includes('milvus') || hint.includes('vector') || hint.includes('embedding')) {
    return {
      bgColor: '#00a1ea',
      icon: (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="#fff">
          <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.2l6.5 3.6L12 11.4 5.5 7.8 12 4.2zm-7 5l6 3.3v6.7l-6-3.3v-6.7zm8 10V12.5l6-3.3v6.7l-6 3.3z" opacity=".9"/>
        </svg>
      ),
    };
  }

  return null;
}

// Helper: determine if an icon color needs to be darker for contrast on a background
export function needsDarkIcon(bgColor: string): boolean {
  // Parse hex to RGB and compute luminance
  const hex = bgColor.replace('#', '');
  if (hex.length < 6) return false;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Relative luminance (simplified)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65; // light background needs dark icon
}

function getCategoryForType(type: string): string {
  const typeMap: Record<string, string> = {
    trigger: 'trigger',
    llm_completion: 'ai', a2a: 'ai', agent_spawn: 'ai', openagentic_llm: 'ai',
    multi_agent: 'ai', reasoning: 'ai', structured_output: 'ai', guardrails: 'ai',
    mcp_tool: 'action', openagentic: 'action', webhook_response: 'action',
    http_request: 'http',
    code: 'code',
    condition: 'logic', loop: 'logic', wait: 'logic', switch: 'logic',
    parallel: 'logic', error_handler: 'logic',
    transform: 'data', merge: 'data', rag_query: 'data', file_upload: 'data',
    user_context: 'data', text_splitter: 'data', embedding: 'data',
    vector_store: 'data', document_loader: 'data',
    approval: 'approval', human_approval: 'approval',
    synth: 'agents',
    agent_single: 'agents', agent_pool: 'agents', agent_supervisor: 'agents',
    slack_message: 'integration', teams_message: 'integration', outlook_email: 'integration',
    send_email: 'integration', pagerduty_incident: 'integration', servicenow_ticket: 'integration',
    jira_issue: 'integration', discord_message: 'integration',
    text: 'annotation',
    // AI Builder fallback types — map to closest category
    output: 'data', output_result: 'data', result: 'data',
    input: 'trigger', start: 'trigger', end: 'data',
    prompt: 'ai', chat: 'ai', completion: 'ai',
    api: 'http', rest: 'http', fetch: 'http',
    branch: 'logic', if: 'logic', filter: 'data',
    email: 'integration', notification: 'integration',
  };
  return typeMap[type] || 'action';
}

// Config preview items
function getConfigPreview(data: Record<string, any>, nodeType: string): string {
  if (data.model) return data.model;
  if (data.toolName) return data.toolName;
  if (data.method && nodeType === 'http_request') return `${data.method} ${(data.url || '').substring(0, 25)}`;
  if (data.language) return data.language;
  if (data.operator) return `${data.operator}`;
  if (data.triggerType && data.triggerType !== 'manual') return data.triggerType;
  if (data.agentType) return data.agentType;
  if (data.duration && nodeType === 'wait') return `${data.duration}${data.unit || 'ms'}`;
  // Data pipeline nodes
  if (nodeType === 'text_splitter') return `${data.strategy || 'recursive'} / ${data.chunkSize || 512}`;
  if (nodeType === 'embedding') return data.model || 'text-embedding-3-small';
  if (nodeType === 'vector_store') return `${data.operation || 'upsert'} → ${data.collection || 'default'}`;
  if (nodeType === 'document_loader') return data.sourceType || 'url';
  if (nodeType === 'structured_output') return data.model || 'gpt-4.1';
  if (nodeType === 'guardrails') return (data.checks || []).join(', ') || 'pii, injection';
  if (data.collection && nodeType === 'rag_query') return data.collection;
  if (data.mergeStrategy && nodeType === 'merge') return data.mergeStrategy;
  if (data.transformType && nodeType === 'transform') return data.transformType;
  if (data.role) return data.role;
  return '';
}

// Output handles based on node type
function getOutputHandles(data: Record<string, any>, nodeType: string): Array<{ id: string; label: string; color: string; position: number }> {
  if (nodeType === 'condition' || data.operator) {
    return [
      { id: 'true', label: 'true', color: '#22c55e', position: 35 },
      { id: 'false', label: 'false', color: '#f44336', position: 65 },
    ];
  }
  if (nodeType === 'approval' || nodeType === 'human_approval') {
    return [
      { id: 'approved', label: 'yes', color: '#22c55e', position: 35 },
      { id: 'rejected', label: 'no', color: '#f44336', position: 65 },
    ];
  }
  if (nodeType === 'loop') {
    return [
      { id: 'item', label: 'each', color: '#00bcd4', position: 35 },
      { id: 'done', label: 'done', color: '#22c55e', position: 65 },
    ];
  }
  return [{ id: 'output', label: '', color: '', position: 50 }];
}

// Format execution output to readable string
function formatOutput(output: any): string {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (output?.content) return String(output.content);
  if (output?.model) return `Model: ${output.model}${output.tokens ? ` | ${output.tokens} tokens` : ''}`;
  try { return JSON.stringify(output, null, 2); } catch { return String(output); }
}

// Build a config preview for the tooltip (before execution)
function getTooltipConfigPreview(data: Record<string, any>, nodeType: string): string[] {
  const items: string[] = [];
  if (data.nodeDescription) items.push(data.nodeDescription);
  if (nodeType === 'mcp_tool') {
    if (data.toolServer) items.push(`Server: ${data.toolServer}`);
    if (data.toolName) items.push(`Tool: ${data.toolName}`);
  }
  if (nodeType === 'llm_completion' || nodeType === 'openagentic_llm') {
    if (data.model) items.push(`Model: ${data.model}`);
    if (data.prompt) items.push(`Prompt: ${data.prompt.substring(0, 100)}${data.prompt.length > 100 ? '...' : ''}`);
    if (data.temperature != null) items.push(`Temperature: ${data.temperature}`);
  }
  if (nodeType === 'agent_single') {
    if (data.agentId) items.push(`Agent: ${data.agentId}`);
    if (data.role) items.push(`Role: ${data.role}`);
    if (data.systemPrompt) items.push(`System: ${data.systemPrompt.substring(0, 100)}${data.systemPrompt.length > 100 ? '...' : ''}`);
  }
  if (nodeType === 'http_request') {
    if (data.method && data.url) items.push(`${data.method} ${data.url.substring(0, 60)}`);
    if (data.headers) items.push(`Headers: ${Object.keys(typeof data.headers === 'object' ? data.headers : {}).length} configured`);
  }
  if (nodeType === 'condition') {
    if (data.condition || data.expression) items.push(`If: ${(data.condition || data.expression).substring(0, 60)}`);
  }
  if (nodeType === 'code' || nodeType === 'openagentic') {
    if (data.language) items.push(`Language: ${data.language}`);
    if (data.code) items.push(`Code: ${data.code.split('\n').length} lines`);
  }
  if (nodeType === 'synth' || nodeType === 'oat') {
    if (data.intent) items.push(`Intent: ${data.intent.substring(0, 100)}${data.intent.length > 100 ? '...' : ''}`);
  }
  if (nodeType === 'delay' || nodeType === 'wait') {
    if (data.duration) items.push(`Wait: ${data.duration}${data.unit || 'ms'}`);
  }
  if (nodeType === 'loop' || nodeType === 'foreach') {
    if (data.collection) items.push(`Over: ${data.collection.substring(0, 60)}`);
    if (data.maxIterations) items.push(`Max: ${data.maxIterations} iterations`);
  }
  return items;
}

// Hover tooltip — shows contextual info before, during, and after execution
const NodeHoverTooltip: React.FC<{ data: Record<string, any>; nodeType: string; catColor: string; nodeId?: string }> = ({ data, nodeType, catColor, nodeId }) => {
  const output = data.executionOutput;
  const error = data.executionError;
  const duration = data.executionTimeMs;
  const status = data.executionState;
  const validationErrors = data.validationErrors as Array<{ message: string; field?: string }> | undefined;

  const outputText = formatOutput(output);
  const configPreview = getTooltipConfigPreview(data, nodeType);
  const nodeConfig = nodeTypeConfigs[nodeType as keyof typeof nodeTypeConfigs];
  const description = nodeConfig?.description;

  // Show tooltip even before execution (description + config preview + validation)
  const hasPreExecContent = description || configPreview.length > 0 || (validationErrors && validationErrors.length > 0);
  if (!status && !hasPreExecContent) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
      marginBottom: 8, zIndex: 9999, pointerEvents: 'auto',
      background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
      padding: '10px 14px', minWidth: 280, maxWidth: 480, width: 'max-content',
      boxShadow: `0 8px 24px rgba(0,0,0,0.4), 0 0 8px ${catColor}20`,
      fontSize: 11, color: '#c9d1d9', lineHeight: 1.5,
    }}>
      {/* Pre-execution: description + config */}
      {!status && (
        <>
          {description && (
            <div style={{ color: '#8b949e', fontSize: 10, marginBottom: configPreview.length > 0 ? 6 : 0 }}>{description}</div>
          )}
          {configPreview.length > 0 && (
            <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '6px 8px', fontSize: 10, fontFamily: "'SF Mono', Monaco, monospace", color: '#c9d1d9' }}>
              {configPreview.map((item, i) => <div key={i}>{item}</div>)}
            </div>
          )}
          {validationErrors && validationErrors.length > 0 && (
            <div style={{ marginTop: 6, background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', borderRadius: 6, padding: '6px 8px' }}>
              {validationErrors.map((err, i) => (
                <div key={i} style={{ color: '#f85149', fontSize: 10 }}>{err.message}</div>
              ))}
            </div>
          )}
        </>
      )}

      {/* During execution: running state */}
      {status === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d29922', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontWeight: 700, color: '#d29922' }}>Running...</span>
          {data.executionStartTime && (
            <span style={{ marginLeft: 'auto', color: '#8b949e', fontFamily: 'monospace', fontSize: 10 }}>
              {Math.round((Date.now() - data.executionStartTime) / 1000)}s
            </span>
          )}
        </div>
      )}

      {/* Post-execution: status + model/tokens/duration + output/error */}
      {status && status !== 'running' && (
        <>
          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: status === 'completed' ? '#2ea043' : '#f85149',
            }} />
            <span style={{ fontWeight: 700, textTransform: 'capitalize', color: '#e6edf3' }}>{status}</span>
          </div>

          {/* Metrics row: model · duration · tokens */}
          {(() => {
            const model = output?.model || output?.modelId;
            const totalTokens = output?.usage?.total_tokens ?? output?._costMeta?.tokens ?? output?.tokens;
            const promptTok = output?.usage?.prompt_tokens ?? output?._costMeta?.promptTokens;
            const completeTok = output?.usage?.completion_tokens ?? output?._costMeta?.completionTokens;
            const durationFmt = duration == null ? null
              : duration < 1000 ? `${duration}ms`
              : `${(duration / 1000).toFixed(1)}s`;
            if (!model && !durationFmt && !totalTokens) return null;
            return (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginBottom: 6,
                background: '#0d1117', border: '1px solid #21262d', borderRadius: 6,
                padding: '5px 8px', fontSize: 10,
              }}>
                {model && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#a5f3fc' }}>
                    <span style={{ fontSize: 9 }}>MODEL</span>
                    <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{model.replace(/-\d{4}-\d{2}-\d{2}$/, '')}</span>
                  </span>
                )}
                {durationFmt && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#86efac' }}>
                    <span style={{ fontSize: 9 }}>TIME</span>
                    <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{durationFmt}</span>
                  </span>
                )}
                {totalTokens != null && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#fbbf24' }}>
                    <span style={{ fontSize: 9 }}>TOKENS</span>
                    <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>
                      {Number(totalTokens).toLocaleString()}
                      {promptTok != null && completeTok != null && (
                        <span style={{ color: '#6b7280', fontSize: 9 }}> ({promptTok}+{completeTok})</span>
                      )}
                    </span>
                  </span>
                )}
              </div>
            );
          })()}

          {error && (
            <div style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.2)', borderRadius: 6, padding: '6px 8px', color: '#f85149', fontSize: 10, fontFamily: "'SF Mono', Monaco, monospace", marginBottom: 4, maxHeight: 240, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {String(error)}
            </div>
          )}

          {outputText && !error && (
            <>
              <div style={{ color: '#8b949e', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Output</div>
              <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '6px 8px', fontSize: 10, fontFamily: "'SF Mono', Monaco, monospace", color: '#c9d1d9', maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {outputText.length > 2000 ? outputText.slice(0, 2000) + '\n... (truncated)' : outputText}
              </div>
            </>
          )}
        </>
      )}

      {/* Click hint */}
      <div style={{ marginTop: 6, color: '#484f58', fontSize: 9, textAlign: 'center' }}>Click node to view full details in panel</div>

      {/* Tooltip arrow */}
      <div style={{ position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)', width: 10, height: 10, background: '#161b22', borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d', rotate: '45deg' }} />
    </div>
  );
};

export const CustomNode = memo(({ id, data, selected, type }: NodeProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const reactFlow = useReactFlow();
  const nodeType = type || 'trigger';

  const rawExecutionState = data.executionState as string | undefined;
  const executionOutput = data.executionOutput;
  const executionTimeMs = data.executionTimeMs as number | undefined;
  const executionError = data.executionError as string | undefined;
  // Override completed→failed when output indicates a logical failure
  const outputIndicatesFailure = rawExecutionState === 'completed' && executionOutput && (
    executionOutput?.status === 'FAIL' ||
    executionOutput?.error ||
    executionOutput?._failedBranch === true
  );
  const executionState = outputIndicatesFailure ? 'failed' : rawExecutionState;
  const executionOrder = data.executionOrder as number | undefined;
  const xrayMode = data.xrayMode as boolean | undefined;
  const validationErrors = data.validationErrors as Array<{ message: string; field?: string }> | undefined;
  const hasValidationErrors = validationErrors && validationErrors.length > 0 && !executionState;

  const category = getCategoryForType(nodeType);
  const catColor = data.color || CATEGORY_COLORS[category] || '#607d8b';
  const subtitle = getConfigPreview(data, nodeType);
  const outputHandles = getOutputHandles(data, nodeType);
  const isAgentNode = ['agent_single', 'agent_spawn', 'agent_pool', 'agent_supervisor', 'multi_agent'].includes(nodeType);

  // Callbacks must be defined before any early returns so all node types can use them
  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const nodes = reactFlow.getNodes();
    const currentNode = nodes.find(n => n.id === id);
    if (!currentNode) return;
    reactFlow.addNodes({
      ...currentNode,
      id: `${nodeType}-${Date.now()}`,
      position: { x: currentNode.position.x + 40, y: currentNode.position.y + 40 },
      data: { ...currentNode.data },
      selected: false,
    });
  }, [id, nodeType, reactFlow]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    reactFlow.deleteElements({ nodes: [{ id }] });
  }, [id, reactFlow]);

  const handleConfigure = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    reactFlow.setNodes(nodes => nodes.map(n => ({ ...n, selected: n.id === id })));
  }, [id, reactFlow]);

  const [isTesting, setIsTesting] = useState(false);
  const handleTestNode = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.onTestNode && nodeType !== 'trigger') {
      setIsTesting(true);
      try {
        await data.onTestNode(id, { type: nodeType, data });
      } finally {
        setIsTesting(false);
      }
    }
  }, [id, nodeType, data]);

  // ── Text/Annotation Node — renders as a styled sticky note ──
  if (nodeType === 'text') {
    // Accent color: use data.color, data.bgColor hint, or a soft default
    const noteColor = data.color || '#f59e0b';
    const noteBg = data.bgColor || 'rgba(245,158,11,0.06)';
    return (
      <div
        className={`wf-node-appear wf-text-node`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ position: 'relative', minWidth: 180, maxWidth: 320 }}
      >
        <div
          className={`${selected ? 'wf-selected' : ''}`}
          style={{
            padding: '0',
            borderRadius: 8,
            background: noteBg,
            border: `1px solid ${selected ? noteColor : noteColor + '40'}`,
            boxShadow: selected ? `0 0 0 2px ${noteColor}30` : 'none',
            overflow: 'hidden',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
        >
          {/* Color stripe at top */}
          <div style={{
            height: 3,
            background: noteColor,
            borderRadius: '8px 8px 0 0',
          }} />
          <div style={{ padding: '8px 12px 10px' }}>
            {data.label && data.label !== 'Note' && (
              <div style={{
                fontSize: 11, fontWeight: 700, marginBottom: 4,
                color: noteColor, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                {data.label}
              </div>
            )}
            <div style={{
              fontSize: data.fontSize || 12,
              lineHeight: 1.6,
              color: 'var(--color-text-secondary, #8b949e)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {data.text || 'Double-click to add a note...'}
            </div>
          </div>
        </div>

        {/* Optional handles so text nodes can be connected if desired */}
        <Handle type="target" position={Position.Left} className="wf-handle" style={{ left: -5, opacity: 0 }} />
        <Handle type="source" position={Position.Right} id="output" className="wf-handle" style={{ right: -5, opacity: 0 }} />

        {/* Hover toolbar */}
        <AnimatePresence>
          {(selected || isHovered) && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.12 }}
              className="wf-hover-toolbar"
            >
              <button className="wf-hover-btn" title="Configure" onClick={handleConfigure}>
                <Settings style={{ width: 14, height: 14 }} />
              </button>
              <button className="wf-hover-btn" title="Duplicate" onClick={handleDuplicate}>
                <Copy style={{ width: 14, height: 14 }} />
              </button>
              <button className="wf-hover-btn wf-hover-btn-danger" title="Delete" onClick={handleDelete}>
                <Trash2 style={{ width: 14, height: 14 }} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const validationState = data.validationState as string | undefined;
  const statusClass = validationState === 'checking' ? 'wf-status-validating'
    : validationState === 'invalid' ? 'wf-status-validation-failed'
    : validationState === 'valid' ? 'wf-status-validation-ok'
    : executionState === 'running' ? 'wf-status-running'
    : executionState === 'completed' ? 'wf-status-success'
    : executionState === 'failed' ? 'wf-status-failed'
    : executionState === 'paused' ? 'wf-status-paused'
    : '';

  return (
    <div
      className="wf-node-appear"
      onMouseEnter={() => {
        setIsHovered(true);
        // Show tooltip on hover: always (for description/config preview + validation), not just after execution
        hoverTimerRef.current = setTimeout(() => setShowTooltip(true), 300);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowTooltip(false);
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
      }}
      style={{ position: 'relative', ...(data.disabled ? { opacity: 0.5 } : {}) }}
    >
      <div
        className={`wf-node-card ${statusClass} ${selected ? 'wf-selected' : ''}`}
        style={{
          ...(hasValidationErrors ? { borderColor: '#f59e0b', boxShadow: '0 0 8px rgba(245,158,11,0.25)' } : {}),
          ...(data.disabled ? { borderStyle: 'dashed' } : {}),
        }}
      >
        {/* Disabled badge */}
        {data.disabled && (
          <div style={{
            position: 'absolute', top: -8, right: -8, zIndex: 10,
            backgroundColor: '#6b7280', color: '#fff',
            fontSize: 8, fontWeight: 800, letterSpacing: '0.05em',
            padding: '2px 6px', borderRadius: 4,
            border: '2px solid var(--color-bg-primary, #0d1117)',
            lineHeight: 1.2, textTransform: 'uppercase',
          }}>
            DISABLED
          </div>
        )}
        {/* Validation warning badge (top-right, before execution) */}
        {hasValidationErrors && (
          <div style={{
            position: 'absolute', top: -8, right: -8, zIndex: 10,
            width: 22, height: 22, borderRadius: '50%',
            backgroundColor: '#f59e0b', color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800,
            boxShadow: '0 2px 6px rgba(245,158,11,0.4)',
            border: '2px solid var(--color-bg-primary, #0d1117)',
          }}>
            {validationErrors!.length}
          </div>
        )}

        {/* Execution order badge */}
        {executionOrder !== undefined && (
          <div className="wf-exec-order-badge" style={{ backgroundColor: catColor }}>
            {executionOrder}
            {executionTimeMs !== undefined && (
              <span style={{ fontSize: '7px', opacity: 0.75, marginLeft: '2px', fontWeight: 600 }}>
                {executionTimeMs < 1000
                  ? `${executionTimeMs}ms`
                  : `${(executionTimeMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
        )}

        {/* Header: icon circle + title + menu */}
        <div className="wf-node-header">
          {(() => {
            const vendor = getVendorIcon(nodeType, data);
            const iconBg = vendor?.bgColor || catColor;
            return (
              <div
                className={`wf-node-icon${executionState === 'running' ? ' wf-node-icon-running' : ''}`}
                style={{
                  backgroundColor: iconBg,
                  boxShadow: isHovered ? `0 0 12px ${iconBg}40` : executionState === 'running' ? `0 0 8px ${iconBg}60` : 'none',
                  transition: 'box-shadow 0.2s ease',
                }}
              >
                {vendor ? vendor.icon : getNodeIcon(nodeType)}
              </div>
            );
          })()}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="wf-node-title">{data.label || 'Node'}</div>
            {subtitle && <div className="wf-node-subtitle">{subtitle}</div>}
          </div>
          <div className="wf-node-menu" onClick={handleConfigure} title="Configure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
            </svg>
          </div>
        </div>

        {/* Agent identity card */}
        {isAgentNode && !executionState && (
          <div style={{
            margin: '0 10px 6px', padding: '5px 8px',
            background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.18)',
            borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 3,
          }}>
            {(data.agentId || data.role) && (
              <div style={{ fontSize: 10, color: '#c4b5fd', fontWeight: 600, lineHeight: 1.3 }}>
                {data.agentId && <span>{data.agentId}</span>}
                {data.agentId && data.role && <span style={{ color: '#8b949e' }}> / </span>}
                {data.role && <span style={{ color: '#a78bfa', fontWeight: 400 }}>{data.role}</span>}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {data.model && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontFamily: "'SF Mono', Monaco, monospace",
                }}>{data.model}</span>
              )}
              {data.tools && Array.isArray(data.tools) && data.tools.length > 0 && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: 'rgba(0,188,212,0.12)', color: '#67e8f9',
                }}>{data.tools.length} tool{data.tools.length !== 1 ? 's' : ''}</span>
              )}
              {data.maxTurns && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: 'rgba(255,152,0,0.12)', color: '#fbbf24',
                }}>{data.maxTurns} turns max</span>
              )}
            </div>
          </div>
        )}

        {/* Validation errors only — no empty "click to configure" placeholder */}
        {!subtitle && !executionState && hasValidationErrors && (
          <div className="wf-node-body" style={{ textAlign: 'center', padding: '4px 12px 8px' }}>
            <AlertCircle style={{ width: 14, height: 14, margin: '0 auto 2px', color: '#f59e0b' }} />
            <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>
              {validationErrors!.length} field{validationErrors!.length > 1 ? 's' : ''} required
            </div>
          </div>
        )}

        {/* Validation errors summary (when node has subtitle but also errors) */}
        {subtitle && hasValidationErrors && !executionState && (
          <div style={{
            padding: '2px 12px 8px', fontSize: 10, color: '#f59e0b',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />
            {validationErrors!.length} issue{validationErrors!.length > 1 ? 's' : ''} — click to fix
          </div>
        )}

        {/* Execution state bar */}
        {executionState && (
          <div className="wf-exec-bar">
            {executionState === 'running' && <div className="wf-exec-spinner" />}
            {executionState === 'completed' && <CheckCircle style={{ width: 12, height: 12, color: '#22c55e' }} />}
            {executionState === 'failed' && <XCircle style={{ width: 12, height: 12, color: '#f44336' }} />}
            <span style={{
              color: executionState === 'running' ? '#ff9800'
                : executionState === 'completed' ? '#22c55e'
                : '#f44336',
              flex: 1,
            }}>
              {executionState}
            </span>
            {executionTimeMs !== undefined && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--color-text-tertiary, #999)' }}>
                <Clock style={{ width: 10, height: 10 }} />
                {executionTimeMs}ms
              </span>
            )}
          </div>
        )}

        {/* Agent live execution details (running) */}
        {isAgentNode && executionState === 'running' && (
          <div style={{
            margin: '0 10px 6px', padding: '4px 8px',
            background: 'rgba(255,152,0,0.06)', border: '1px solid rgba(255,152,0,0.15)',
            borderRadius: 6, fontSize: 10, color: '#fbbf24',
            display: 'flex', flexDirection: 'column', gap: 2,
            animation: 'wf-agent-pulse 2s ease-in-out infinite',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {data.currentTurn != null && data.maxTurns && (
                <span style={{ fontWeight: 600 }}>
                  Turn {data.currentTurn}/{data.maxTurns}
                </span>
              )}
              {data.elapsedMs != null && (
                <span style={{ color: '#8b949e', marginLeft: 'auto', fontSize: 9, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Clock style={{ width: 9, height: 9 }} />
                  {data.elapsedMs >= 1000 ? `${(data.elapsedMs / 1000).toFixed(1)}s` : `${data.elapsedMs}ms`}
                </span>
              )}
            </div>
            {data.currentToolCall && (
              <div style={{
                fontSize: 9, color: '#67e8f9', fontFamily: "'SF Mono', Monaco, monospace",
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                calling {data.currentToolCall}
              </div>
            )}
          </div>
        )}

        {/* Execution output preview — 3 lines, 150 chars */}
        {executionState === 'completed' && executionOutput && (
          <div style={{
            padding: '0 12px 8px',
            fontSize: 10,
            fontFamily: "'SF Mono', Monaco, monospace",
            color: '#8b949e',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as any,
            lineHeight: 1.4,
            wordBreak: 'break-word',
          }}>
            {(() => { const t = formatOutput(executionOutput); return t.length > 150 ? t.slice(0, 150) + '...' : t; })()}
          </div>
        )}

        {/* Agent completed metrics */}
        {isAgentNode && executionState === 'completed' && (
          <div style={{
            padding: '0 12px 6px',
            display: 'flex', flexWrap: 'wrap', gap: 6,
            fontSize: 9, color: '#8b949e',
          }}>
            {executionTimeMs != null && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Clock style={{ width: 9, height: 9 }} />
                {executionTimeMs >= 1000 ? `${(executionTimeMs / 1000).toFixed(1)}s` : `${executionTimeMs}ms`}
              </span>
            )}
            {data.tokensUsed != null && (
              <span>{Number(data.tokensUsed).toLocaleString()} tokens</span>
            )}
            {data.toolCallCount != null && (
              <span>{data.toolCallCount} tool call{data.toolCallCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        )}

        {/* Error preview — 3 lines */}
        {executionState === 'failed' && executionError && (
          <div style={{
            padding: '0 12px 8px',
            fontSize: 10,
            fontFamily: "'SF Mono', Monaco, monospace",
            color: '#f85149',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical' as any,
            lineHeight: 1.4,
            wordBreak: 'break-word',
          }}>
            {String(executionError).length > 150 ? String(executionError).slice(0, 150) + '...' : String(executionError)}
          </div>
        )}

        {(executionState === 'failed' || executionState === 'error') && executionError && (
          <div style={{ padding: '0 12px 10px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('fixNodeWithAI', {
                  detail: {
                    nodeId: id,
                    nodeLabel: data.label || id,
                    nodeType: nodeType,
                    error: executionError,
                    config: JSON.stringify(data, null, 2).substring(0, 500),
                  }
                }));
              }}
              style={{
                background: 'linear-gradient(135deg, #7c4dff, #536dfe)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                padding: '6px 12px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              Fix with AI
            </button>
          </div>
        )}

        {/* X-Ray mode: inline I/O details — scrollable, 500 chars */}
        {xrayMode && executionState === 'completed' && executionOutput && (
          <div className="wf-xray-panel">
            <div className="wf-xray-label">Output</div>
            <pre className="wf-xray-content" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {(() => { const t = formatOutput(executionOutput); return t.length > 500 ? t.slice(0, 500) + '\n... (truncated)' : t; })()}
            </pre>
            {executionTimeMs !== undefined && (
              <div className="wf-xray-meta">
                <Clock style={{ width: 10, height: 10 }} />
                {executionTimeMs}ms
              </div>
            )}
          </div>
        )}
        {xrayMode && executionState === 'failed' && executionError && (
          <div className="wf-xray-panel wf-xray-error">
            <div className="wf-xray-label">Error</div>
            <pre className="wf-xray-content" style={{ color: '#f44336', maxHeight: 200, overflowY: 'auto' }}>
              {String(executionError).length > 500 ? String(executionError).slice(0, 500) + '\n... (truncated)' : String(executionError)}
            </pre>
          </div>
        )}

        {/* Execution badge (top-right) */}
        {executionState === 'running' && (
          <div className="wf-exec-badge" style={{ backgroundColor: '#ff9800' }}>
            <div className="wf-exec-spinner" style={{ width: 8, height: 8, borderWidth: 1.5, borderColor: 'white', borderTopColor: 'transparent' }} />
          </div>
        )}
        {executionState === 'completed' && (
          <div className="wf-exec-badge" style={{ backgroundColor: '#22c55e' }}>
            <CheckCircle style={{ width: 12, height: 12 }} />
          </div>
        )}
        {executionState === 'failed' && (
          <div className="wf-exec-badge" style={{ backgroundColor: '#f44336' }}>
            <XCircle style={{ width: 12, height: 12 }} />
          </div>
        )}

        {/* Error badge - shown when node has execution error */}
        {data.executionError && (
          <div
            className="wf-error-badge"
            title={data.executionError}
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              width: 20,
              height: 20,
              borderRadius: '50%',
              backgroundColor: '#f85149',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              cursor: 'help',
              boxShadow: '0 2px 4px rgba(248,81,73,0.4)',
            }}
          >
            <XCircle style={{ width: 12, height: 12, color: '#fff' }} />
          </div>
        )}

        {/* Validation warning badge */}
        {data.validationErrors && (data.validationErrors as any[]).length > 0 && !data.executionError && (
          <div
            className="wf-validation-badge"
            title={(data.validationErrors as any[]).map((e: any) => e.message).join('\n')}
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              cursor: 'help',
              padding: '0 4px',
              boxShadow: '0 2px 4px rgba(245,158,11,0.4)',
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>
              {(data.validationErrors as any[]).length}
            </span>
          </div>
        )}

        {/* Input Handle */}
        <Handle
          type="target"
          position={Position.Left}
          className="wf-handle"
          style={{ left: -5, '--handle-color': catColor } as React.CSSProperties}
        />

        {/* Output Handles */}
        {outputHandles.map((handle) => (
          <div key={handle.id} style={{ position: 'absolute', right: 0, top: `${handle.position}%` }}>
            {handle.label && (
              <span style={{
                position: 'absolute',
                right: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: handle.color || 'var(--color-text-tertiary, #999)',
                whiteSpace: 'nowrap',
                opacity: 0.7,
              }}>
                {handle.label}
              </span>
            )}
            <Handle
              type="source"
              position={Position.Right}
              id={handle.id}
              className="wf-handle"
              style={{
                right: -5,
                top: 0,
                position: 'relative',
                '--handle-color': handle.color || catColor,
                ...(handle.color ? { borderColor: handle.color } : {}),
              } as React.CSSProperties}
            />
          </div>
        ))}

        {/* Error output handle (when onError routes to error handler) */}
        {data.onError === 'route_to_error_handler' && (
          <Handle
            type="source"
            position={Position.Bottom}
            id="error"
            style={{
              right: 8,
              left: 'auto',
              bottom: -4,
              background: '#ef4444',
              width: 8,
              height: 8,
              border: '2px solid #7f1d1d',
            }}
          />
        )}
      </div>

      {/* Hover Tooltip — shows description/config preview before execution, status during, output after */}
      <AnimatePresence>
        {showTooltip && isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <NodeHoverTooltip data={data} nodeType={nodeType} catColor={catColor} nodeId={id} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover Toolbar */}
      <AnimatePresence>
        {(selected || isHovered) && !executionState && (
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.12 }}
            className="wf-hover-toolbar"
          >
            {data.onTestNode && nodeType !== 'trigger' && (
              <button
                className="wf-hover-btn"
                title={isTesting ? 'Testing...' : 'Test this node'}
                onClick={handleTestNode}
                disabled={isTesting}
                style={isTesting ? { opacity: 0.5 } : undefined}
              >
                <Play style={{ width: 14, height: 14 }} />
              </button>
            )}
            <button className="wf-hover-btn" title="Configure" onClick={handleConfigure}>
              <Settings style={{ width: 14, height: 14 }} />
            </button>
            <button className="wf-hover-btn" title="Duplicate" onClick={handleDuplicate}>
              <Copy style={{ width: 14, height: 14 }} />
            </button>
            <button className="wf-hover-btn wf-hover-btn-danger" title="Delete" onClick={handleDelete}>
              <Trash2 style={{ width: 14, height: 14 }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

CustomNode.displayName = 'CustomNode';
