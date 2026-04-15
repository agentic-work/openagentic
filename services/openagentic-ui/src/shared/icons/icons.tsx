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
 * OpenAgentic Icon Library
 * High-quality, semantic SVG icons
 *
 * All icons are designed on a 24x24 grid with 2px stroke width.
 * Icons use currentColor for easy theming.
 */

import React from 'react';
import { createIcon, createFilledIcon } from './createIcon';

// ============================================================================
// A
// ============================================================================

/** Activity/pulse monitor icon - represents live data or monitoring */
export const Activity = createIcon(
  'Activity',
  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
);

/** Alert circle - informational warning */
export const AlertCircle = createIcon(
  'AlertCircle',
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </>
);

/** Alert triangle - warning/caution indicator */
export const AlertTriangle = createIcon(
  'AlertTriangle',
  <>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>
);

/** Arrow left - navigation back */
export const ArrowLeft = createIcon(
  'ArrowLeft',
  <>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </>
);

/** Arrow right - navigation forward */
export const ArrowRight = createIcon(
  'ArrowRight',
  <>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </>
);

/** Arrow up - submit/send action */
export const ArrowUp = createIcon(
  'ArrowUp',
  <>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </>
);

// ============================================================================
// B
// ============================================================================

/** Bar chart - analytics/statistics */
export const BarChart = createIcon(
  'BarChart',
  <>
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </>
);

/** Book - documentation/reading */
export const Book = createIcon(
  'Book',
  <>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
  </>
);

/** Brain - AI/intelligence/thinking */
export const Brain = createIcon(
  'Brain',
  <>
    <path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 011.98-3A2.5 2.5 0 019.5 2z" />
    <path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44 2.5 2.5 0 002.96-3.08 3 3 0 00.34-5.58 2.5 2.5 0 00-1.32-4.24 2.5 2.5 0 00-1.98-3A2.5 2.5 0 0014.5 2z" />
  </>
);

/** Building - organization/company */
export const Building = createIcon(
  'Building',
  <>
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M12 10h.01" />
    <path d="M12 14h.01" />
    <path d="M16 10h.01" />
    <path d="M16 14h.01" />
    <path d="M8 10h.01" />
    <path d="M8 14h.01" />
  </>
);

// ============================================================================
// C
// ============================================================================

/** Calendar - date/scheduling */
export const Calendar = createIcon(
  'Calendar',
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </>
);

/** Check - confirmation/success */
export const Check = createIcon(
  'Check',
  <polyline points="20 6 9 17 4 12" />
);

/** Check check - double confirmation */
export const CheckCheck = createIcon(
  'CheckCheck',
  <>
    <polyline points="9 11 12 14 22 4" />
    <polyline points="21 12 21 19 3 19 3 5 12 5" />
  </>
);

/** Check circle - success state */
export const CheckCircle = createIcon(
  'CheckCircle',
  <>
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </>
);

/** Check circle 2 - filled success */
export const CheckCircle2 = createIcon(
  'CheckCircle2',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M9 12l2 2 4-4" />
  </>
);

/** Check square - checkbox checked */
export const CheckSquare = createIcon(
  'CheckSquare',
  <>
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
  </>
);

/** Chevron down - expand/dropdown */
export const ChevronDown = createIcon(
  'ChevronDown',
  <polyline points="6 9 12 15 18 9" />
);

/** Chevron left - navigate left */
export const ChevronLeft = createIcon(
  'ChevronLeft',
  <polyline points="15 18 9 12 15 6" />
);

/** Chevron right - navigate right/expand */
export const ChevronRight = createIcon(
  'ChevronRight',
  <polyline points="9 18 15 12 9 6" />
);

/** Chevron up - collapse */
export const ChevronUp = createIcon(
  'ChevronUp',
  <polyline points="18 15 12 9 6 15" />
);

/** Circle - empty state/radio button */
export const Circle = createIcon(
  'Circle',
  <circle cx="12" cy="12" r="10" />
);

/** Clock - time/duration */
export const Clock = createIcon(
  'Clock',
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>
);

/** Cloud - cloud services */
export const Cloud = createIcon(
  'Cloud',
  <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
);

/** Code - source code */
export const Code = createIcon(
  'Code',
  <>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </>
);

/** Code 2 - code mode/terminal */
export const Code2 = createIcon(
  'Code2',
  <>
    <path d="M18 16l4-4-4-4" />
    <path d="M6 8l-4 4 4 4" />
    <path d="M14.5 4l-5 16" />
  </>
);

/** Coins - tokens/currency */
export const Coins = createIcon(
  'Coins',
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1110.34 18" />
    <path d="M7 6h1v4" />
    <path d="M16.71 13.88l.7.71-2.82 2.82" />
  </>
);

/** Copy - duplicate/clipboard */
export const Copy = createIcon(
  'Copy',
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </>
);

/** Cpu - processor/computing */
export const Cpu = createIcon(
  'Cpu',
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
    <rect x="9" y="9" width="6" height="6" />
    <line x1="9" y1="1" x2="9" y2="4" />
    <line x1="15" y1="1" x2="15" y2="4" />
    <line x1="9" y1="20" x2="9" y2="23" />
    <line x1="15" y1="20" x2="15" y2="23" />
    <line x1="20" y1="9" x2="23" y2="9" />
    <line x1="20" y1="14" x2="23" y2="14" />
    <line x1="1" y1="9" x2="4" y2="9" />
    <line x1="1" y1="14" x2="4" y2="14" />
  </>
);

// ============================================================================
// D
// ============================================================================

/** Database - data storage */
export const Database = createIcon(
  'Database',
  <>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </>
);

/** Dollar sign - money/pricing */
export const DollarSign = createIcon(
  'DollarSign',
  <>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </>
);

/** Download - save/export */
export const Download = createIcon(
  'Download',
  <>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </>
);

// ============================================================================
// E
// ============================================================================

/** Edit 2 - edit/modify */
export const Edit2 = createIcon(
  'Edit2',
  <>
    <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </>
);

/** Edit 3 - edit with line */
export const Edit3 = createIcon(
  'Edit3',
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </>
);

/** External link - open in new tab */

/** Eye - visibility/view */
export const Eye = createIcon(
  'Eye',
  <>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </>
);

/** Eye off - hidden/invisible */
export const EyeOff = createIcon(
  'EyeOff',
  <>
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </>
);

// ============================================================================
// F
// ============================================================================

/** File - generic file */
export const File = createIcon(
  'File',
  <>
    <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </>
);

/** File code - source code file */
export const FileCode = createIcon(
  'FileCode',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M10 13l-2 2 2 2" />
    <path d="M14 17l2-2-2-2" />
  </>
);

/** File down - download file */
export const FileDown = createIcon(
  'FileDown',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M12 18v-6" />
    <path d="M9 15l3 3 3-3" />
  </>
);

/** File output - export/output file */
export const FileOutput = createIcon(
  'FileOutput',
  <>
    <path d="M4 22h14a2 2 0 002-2V7.5L14.5 2H6a2 2 0 00-2 2v4" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M2 15h10" />
    <path d="M9 18l3-3-3-3" />
  </>
);

/** File text - document/text file */
export const FileText = createIcon(
  'FileText',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </>
);

/** Folder - directory */
export const Folder = createIcon(
  'Folder',
  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
);

/** Folder open - expanded directory */
export const FolderOpen = createIcon(
  'FolderOpen',
  <>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    <path d="M2 10h20" />
  </>
);

// ============================================================================
// G
// ============================================================================

/** Git branch - version control branch */
export const GitBranch = createIcon(
  'GitBranch',
  <>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 01-9 9" />
  </>
);

/** Git commit - version control commit */
export const GitCommit = createIcon(
  'GitCommit',
  <>
    <circle cx="12" cy="12" r="4" />
    <line x1="1.05" y1="12" x2="7" y2="12" />
    <line x1="17.01" y1="12" x2="22.96" y2="12" />
  </>
);

/** Globe - world/international */
export const Globe = createIcon(
  'Globe',
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
  </>
);

// ============================================================================
// H
// ============================================================================

/** Hard drive - storage/disk */
export const HardDrive = createIcon(
  'HardDrive',
  <>
    <line x1="22" y1="12" x2="2" y2="12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    <line x1="6" y1="16" x2="6.01" y2="16" />
    <line x1="10" y1="16" x2="10.01" y2="16" />
  </>
);

/** Help circle - help/info */
export const HelpCircle = createIcon(
  'HelpCircle',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>
);

/** Hash - hashtag/number sign */
export const Hash = createIcon(
  'Hash',
  <>
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </>
);

/** Home - homepage/dashboard */
export const Home = createIcon(
  'Home',
  <>
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </>
);

// ============================================================================
// I
// ============================================================================

/** Image - picture/photo */
export const Image = createIcon(
  'Image',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </>
);

/** Info - information */
export const Info = createIcon(
  'Info',
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </>
);

// ============================================================================
// L
// ============================================================================

/** Layers - stacked items/layers */
export const Layers = createIcon(
  'Layers',
  <>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </>
);

/** Lightbulb - idea/suggestion */
export const Lightbulb = createIcon(
  'Lightbulb',
  <>
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 019 14" />
  </>
);

/** Line chart - trends/analytics */
export const LineChart = createIcon(
  'LineChart',
  <>
    <path d="M3 3v18h18" />
    <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
  </>
);

/** Loader - loading spinner (static) */
export const Loader = createIcon(
  'Loader',
  <>
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </>
);

/** Loader 2 - simplified loader */
export const Loader2 = createIcon(
  'Loader2',
  <path d="M21 12a9 9 0 11-6.219-8.56" />
);

/** Lock - locked/secure */
export const Lock = createIcon(
  'Lock',
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </>
);

/** Link - hyperlink/chain */
export const Link = createIcon(
  'Link',
  <>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </>
);

/** Link 2 - simple link */
export const Link2 = createIcon(
  'Link2',
  <>
    <path d="M15 7h3a5 5 0 015 5 5 5 0 01-5 5h-3m-6 0H6a5 5 0 01-5-5 5 5 0 015-5h3" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </>
);

/** Log out - sign out */
export const LogOut = createIcon(
  'LogOut',
  <>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>
);

// ============================================================================
// M
// ============================================================================

/** Mail - email */
export const Mail = createIcon(
  'Mail',
  <>
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </>
);

/** Maximize 2 - fullscreen */
export const Maximize2 = createIcon(
  'Maximize2',
  <>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </>
);

/** Menu - hamburger menu */
export const Menu = createIcon(
  'Menu',
  <>
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </>
);

/** Message circle - chat/comment */
export const MessageCircle = createIcon(
  'MessageCircle',
  <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
);

/** Message square - conversation */
export const MessageSquare = createIcon(
  'MessageSquare',
  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
);

/** Mic - microphone/audio */
export const Mic = createIcon(
  'Mic',
  <>
    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path d="M19 10v2a7 7 0 01-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </>
);

/** Minimize 2 - exit fullscreen */
export const Minimize2 = createIcon(
  'Minimize2',
  <>
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </>
);

/** Minus - subtract/remove */
export const Minus = createIcon(
  'Minus',
  <line x1="5" y1="12" x2="19" y2="12" />
);

/** Moon - dark mode */
export const Moon = createIcon(
  'Moon',
  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
);

/** More horizontal - options/actions */
export const MoreHorizontal = createIcon(
  'MoreHorizontal',
  <>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </>
);

// ============================================================================
// N
// ============================================================================

/** Network - connections/networking */
export const Network = createIcon(
  'Network',
  <>
    <rect x="16" y="16" width="6" height="6" rx="1" />
    <rect x="2" y="16" width="6" height="6" rx="1" />
    <rect x="9" y="2" width="6" height="6" rx="1" />
    <path d="M5 16v-3a1 1 0 011-1h12a1 1 0 011 1v3" />
    <path d="M12 12V8" />
  </>
);

// ============================================================================
// P
// ============================================================================

/** Palette - colors/themes */
export const Palette = createIcon(
  'Palette',
  <>
    <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
  </>
);

/** Panel left - left sidebar */
export const PanelLeft = createIcon(
  'PanelLeft',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </>
);

/** Panel right - right sidebar */
export const PanelRight = createIcon(
  'PanelRight',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </>
);

/** Paperclip - attachment */
export const Paperclip = createIcon(
  'Paperclip',
  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
);

/** Play - start/run */
export const Play = createIcon(
  'Play',
  <polygon points="5 3 19 12 5 21 5 3" />
);

/** Plus - add/create */
export const Plus = createIcon(
  'Plus',
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>
);

/** Power - power on/enabled state */
export const Power = createIcon(
  'Power',
  <>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </>
);

/** PowerOff - power off/disabled state */
export const PowerOff = createIcon(
  'PowerOff',
  <>
    <path d="M18.36 6.64A9 9 0 0 1 20.77 15" />
    <path d="M6.16 6.16a9 9 0 1 0 12.68 12.68" />
    <path d="M12 2v4" />
    <path d="m2 2 20 20" />
  </>
);

/** Puzzle icon - plugins/integrations */
export const PuzzleIcon = createIcon(
  'PuzzleIcon',
  <>
    <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 01-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 10-3.214 3.214c.446.166.855.497.925.968a.979.979 0 01-.276.837l-1.61 1.61a2.404 2.404 0 01-1.705.707 2.402 2.402 0 01-1.704-.706l-1.568-1.568a1.026 1.026 0 00-.878-.29c-.493.074-.84.504-1.017.968a2.5 2.5 0 11-3.237-3.237c.464-.177.894-.524.967-1.017a1.026 1.026 0 00-.289-.878l-1.568-1.568A2.402 2.402 0 011.998 12c0-.617.236-1.234.706-1.704L4.315 8.69a.979.979 0 01.837-.276c.47.07.802.48.968.925a2.501 2.501 0 103.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 01.276-.837l1.61-1.61a2.404 2.404 0 011.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.878.29.493-.074.84-.504 1.017-.968a2.5 2.5 0 113.237 3.237c-.464.177-.894.524-.967 1.017z" />
  </>
);

// ============================================================================
// R
// ============================================================================

/** Refresh CW - reload/refresh */
export const RefreshCw = createIcon(
  'RefreshCw',
  <>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
  </>
);

/** Rotate CCW - undo rotation */
export const RotateCcw = createIcon(
  'RotateCcw',
  <>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
  </>
);

// ============================================================================
// S
// ============================================================================

/** Save - save/persist */
export const Save = createIcon(
  'Save',
  <>
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </>
);

/** Search - find/filter */
export const Search = createIcon(
  'Search',
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>
);

/** Send - submit/send message */
export const Send = createIcon(
  'Send',
  <>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </>
);

/** Server - backend/infrastructure */
export const Server = createIcon(
  'Server',
  <>
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </>
);

/** Settings - configuration */
export const Settings = createIcon(
  'Settings',
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </>
);

/** Shield - security */
export const Shield = createIcon(
  'Shield',
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
);

/** Shield check - verified/protected */
export const ShieldCheck = createIcon(
  'ShieldCheck',
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </>
);

/** Shield X - security breach/denied */
export const ShieldX = createIcon(
  'ShieldX',
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9.5 9.5l5 5" />
    <path d="M14.5 9.5l-5 5" />
  </>
);

/** Skull - danger/warning */
export const Skull = createIcon(
  'Skull',
  <>
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <path d="M8 20v2h8v-2" />
    <path d="M12.5 17l-.5-1-.5 1h1z" />
    <path d="M16 20a2 2 0 002-2V8A6 6 0 006 8v10a2 2 0 002 2" />
  </>
);

/** Sliders horizontal - adjustments */
export const SlidersHorizontal = createIcon(
  'SlidersHorizontal',
  <>
    <line x1="21" y1="4" x2="14" y2="4" />
    <line x1="10" y1="4" x2="3" y2="4" />
    <line x1="21" y1="12" x2="12" y2="12" />
    <line x1="8" y1="12" x2="3" y2="12" />
    <line x1="21" y1="20" x2="16" y2="20" />
    <line x1="12" y1="20" x2="3" y2="20" />
    <line x1="14" y1="2" x2="14" y2="6" />
    <line x1="8" y1="10" x2="8" y2="14" />
    <line x1="16" y1="18" x2="16" y2="22" />
  </>
);

/** Smile - emoji/happy */
export const Smile = createIcon(
  'Smile',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </>
);

/** Sparkles - AI/magic */
export const Sparkles = createIcon(
  'Sparkles',
  <>
    <path d="M9.937 15.5A2 2 0 008.5 14.063l-6.135-1.582a.5.5 0 010-.962L8.5 9.936A2 2 0 009.937 8.5l1.582-6.135a.5.5 0 01.962 0L14.063 8.5A2 2 0 0015.5 9.937l6.135 1.582a.5.5 0 010 .962L15.5 14.063a2 2 0 00-1.437 1.437l-1.582 6.135a.5.5 0 01-.962 0L9.937 15.5z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </>
);

/** Square - stop/checkbox empty */
export const Square = createIcon(
  'Square',
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
);

/** Sun - light mode */
export const Sun = createIcon(
  'Sun',
  <>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </>
);

// ============================================================================
// T
// ============================================================================

/** Tag - label/category */
export const Tag = createIcon(
  'Tag',
  <>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </>
);

/** Terminal - command line */
export const Terminal = createIcon(
  'Terminal',
  <>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </>
);

/** Trash 2 - delete */
export const Trash2 = createIcon(
  'Trash2',
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </>
);

/** Trending down - decrease */
export const TrendingDown = createIcon(
  'TrendingDown',
  <>
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    <polyline points="17 18 23 18 23 12" />
  </>
);

/** Trending up - increase */
export const TrendingUp = createIcon(
  'TrendingUp',
  <>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </>
);

/** Type - text/typography */
export const Type = createIcon(
  'Type',
  <>
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </>
);

// ============================================================================
// U
// ============================================================================

/** Unlock - unlocked state */
export const Unlock = createIcon(
  'Unlock',
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 019.9-1" />
  </>
);

/** Upload - upload file */
export const Upload = createIcon(
  'Upload',
  <>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </>
);

/** User - single user */
export const User = createIcon(
  'User',
  <>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);

/** User minus - remove user */
export const UserMinus = createIcon(
  'UserMinus',
  <>
    <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="23" y1="11" x2="17" y2="11" />
  </>
);

/** User plus - add user */
export const UserPlus = createIcon(
  'UserPlus',
  <>
    <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="20" y1="8" x2="20" y2="14" />
    <line x1="23" y1="11" x2="17" y2="11" />
  </>
);

/** Users - multiple users/team */
export const Users = createIcon(
  'Users',
  <>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </>
);

// ============================================================================
// W
// ============================================================================

/** Volume 2 - audio on/speaker */
export const Volume2 = createIcon(
  'Volume2',
  <>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
  </>
);

/** Volume X - audio muted */
export const VolumeX = createIcon(
  'VolumeX',
  <>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </>
);

/** Waves - background effects */
export const Waves = createIcon(
  'Waves',
  <>
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
  </>
);

/** Wrench - tools/settings */
export const Wrench = createIcon(
  'Wrench',
  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
);

/** Workflow - visual workflow builder/automation */
export const Workflow = createIcon(
  'Workflow',
  <>
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="9" y="15" width="6" height="6" rx="1" />
    <path d="M6 9v2a1 1 0 001 1h10a1 1 0 001-1V9" />
    <path d="M12 12v3" />
  </>
);

// ============================================================================
// X
// ============================================================================

/** X - close/dismiss */
export const X = createIcon(
  'X',
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>
);

/** X circle - error/closed state */
export const XCircle = createIcon(
  'XCircle',
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </>
);

// ============================================================================
// Z
// ============================================================================

/** Zap - speed/performance/lightning */
export const Zap = createIcon(
  'Zap',
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
);

// ============================================================================
// Additional Icons (Extended Set)
// ============================================================================

/** Archive - archived/storage */
export const Archive = createIcon(
  'Archive',
  <>
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </>
);

/** Arrow down - navigate down */
export const ArrowDown = createIcon(
  'ArrowDown',
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </>
);

/** Arrow down right - diagonal down-right */
export const ArrowDownRight = createIcon(
  'ArrowDownRight',
  <>
    <line x1="7" y1="7" x2="17" y2="17" />
    <polyline points="17 7 17 17 7 17" />
  </>
);

/** Arrow up right - diagonal up-right */
export const ArrowUpRight = createIcon(
  'ArrowUpRight',
  <>
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="7 7 17 7 17 17" />
  </>
);

/** Bar chart 2 - alternative chart */
export const BarChart2 = createIcon(
  'BarChart2',
  <>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </>
);

/** Bar chart 3 - horizontal bar chart */
export const BarChart3 = createIcon(
  'BarChart3',
  <>
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </>
);

/** Beaker - lab/testing */
export const Beaker = createIcon(
  'Beaker',
  <>
    <path d="M4.5 3h15" />
    <path d="M6 3v16a2 2 0 002 2h8a2 2 0 002-2V3" />
    <path d="M6 14h12" />
  </>
);

/** Bot - AI/robot */
export const Bot = createIcon(
  'Bot',
  <>
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" />
    <line x1="16" y1="16" x2="16" y2="16" />
  </>
);

/** Box - package/container */
export const Box = createIcon(
  'Box',
  <>
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </>
);

/** Braces - code/JSON */
export const Braces = createIcon(
  'Braces',
  <>
    <path d="M8 3H7a2 2 0 00-2 2v5a2 2 0 01-2 2 2 2 0 012 2v5c0 1.1.9 2 2 2h1" />
    <path d="M16 21h1a2 2 0 002-2v-5c0-1.1.9-2 2-2a2 2 0 01-2-2V5a2 2 0 00-2-2h-1" />
  </>
);

/** Command - keyboard shortcut */
export const Command = createIcon(
  'Command',
  <>
    <path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z" />
  </>
);

/** Credit card - payment */
export const CreditCard = createIcon(
  'CreditCard',
  <>
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </>
);

/** Edit - edit/modify (alias to Edit2) */
export const Edit = createIcon(
  'Edit',
  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
);

/** File archive - compressed file */
export const FileArchive = createIcon(
  'FileArchive',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M10 12v8" />
    <path d="M14 12v8" />
    <path d="M10 12h4" />
  </>
);

/** File check - verified file */
export const FileCheck = createIcon(
  'FileCheck',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M9 15l2 2 4-4" />
  </>
);

/** File image - image file */
export const FileImage = createIcon(
  'FileImage',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <circle cx="10" cy="13" r="2" />
    <path d="M20 17l-1.5-1.5a2 2 0 00-3 0L6 17" />
  </>
);

/** File JSON - JSON file */
export const FileJson = createIcon(
  'FileJson',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M10 12a1 1 0 00-1 1v1a1 1 0 01-1 1 1 1 0 011 1v1a1 1 0 001 1" />
    <path d="M14 18a1 1 0 001-1v-1a1 1 0 011-1 1 1 0 01-1-1v-1a1 1 0 00-1-1" />
  </>
);

/** File plus - add file */
export const FilePlus = createIcon(
  'FilePlus',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </>
);

/** File spreadsheet - table/excel file */
export const FileSpreadsheet = createIcon(
  'FileSpreadsheet',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 13h2" />
    <path d="M8 17h2" />
    <path d="M14 13h2" />
    <path d="M14 17h2" />
  </>
);

/** File warning - file with warning */
export const FileWarning = createIcon(
  'FileWarning',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M12 11v4" />
    <path d="M12 18h.01" />
  </>
);

/** File X - remove/delete file */
export const FileX = createIcon(
  'FileX',
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9.5" y1="12.5" x2="14.5" y2="17.5" />
    <line x1="14.5" y1="12.5" x2="9.5" y2="17.5" />
  </>
);

/** Film - video/movie */
export const Film = createIcon(
  'Film',
  <>
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
    <line x1="7" y1="2" x2="7" y2="22" />
    <line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="2" y1="7" x2="7" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" />
    <line x1="17" y1="17" x2="22" y2="17" />
    <line x1="17" y1="7" x2="22" y2="7" />
  </>
);

/** Filter - filter/funnel */
export const Filter = createIcon(
  'Filter',
  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
);

/** Folder plus - new folder */
export const FolderPlus = createIcon(
  'FolderPlus',
  <>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </>
);

/** Folders - multiple folders */
export const Folders = createIcon(
  'Folders',
  <>
    <path d="M20 17a2 2 0 002-2V9a2 2 0 00-2-2h-3.9a2 2 0 01-1.69-.9l-.81-1.2a2 2 0 00-1.67-.9H8a2 2 0 00-2 2v9a2 2 0 002 2z" />
    <path d="M2 8v11a2 2 0 002 2h14" />
  </>
);

/** Gauge - performance/speed */
export const Gauge = createIcon(
  'Gauge',
  <>
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-3.62-1.4 2 2 0 01.53-1.43l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </>
);

/** Grid - grid layout */
export const Grid = createIcon(
  'Grid',
  <>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </>
);

/** Grid 3x3 - 3x3 grid */
export const Grid3x3 = createIcon(
  'Grid3x3',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </>
);

/** Key - key/authentication */
export const Key = createIcon(
  'Key',
  <>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </>
);

/** List - list view */
export const List = createIcon(
  'List',
  <>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </>
);

/** ListChecks - checklist with checkmarks */
export const ListChecks = createIcon(
  'ListChecks',
  <>
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </>
);

/** List todo - todo list */
export const ListTodo = createIcon(
  'ListTodo',
  <>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="M3 17h6" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </>
);

/** Monitor - display/screen */
export const Monitor = createIcon(
  'Monitor',
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </>
);

/** More vertical - vertical ellipsis */
export const MoreVertical = createIcon(
  'MoreVertical',
  <>
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </>
);

/** Music - audio/music */
export const Music = createIcon(
  'Music',
  <>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </>
);

/** Package - package/module */
export const Package = createIcon(
  'Package',
  <>
    <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </>
);

/** Panel left close - close left panel */
export const PanelLeftClose = createIcon(
  'PanelLeftClose',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <path d="M9 3v18" />
    <path d="M16 15l-3-3 3-3" />
  </>
);

/** Panel left open - open left panel */
export const PanelLeftOpen = createIcon(
  'PanelLeftOpen',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <path d="M9 3v18" />
    <path d="M14 9l3 3-3 3" />
  </>
);

/** Panel right close - close right panel */
export const PanelRightClose = createIcon(
  'PanelRightClose',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <path d="M15 3v18" />
    <path d="M8 9l3 3-3 3" />
  </>
);

/** Panel right open - open right panel */
export const PanelRightOpen = createIcon(
  'PanelRightOpen',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <path d="M15 3v18" />
    <path d="M10 15l-3-3 3-3" />
  </>
);

/** Pause - pause playback */
export const Pause = createIcon(
  'Pause',
  <>
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </>
);

/** Play circle - play button */
export const PlayCircle = createIcon(
  'PlayCircle',
  <>
    <circle cx="12" cy="12" r="10" />
    <polygon points="10 8 16 12 10 16 10 8" />
  </>
);

/** Printer - print */
export const Printer = createIcon(
  'Printer',
  <>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </>
);

/** Rotate CW - rotate clockwise */
export const RotateCw = createIcon(
  'RotateCw',
  <>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
  </>
);

/** Share 2 - share/network */
export const Share2 = createIcon(
  'Share2',
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </>
);

/** Sliders - adjustment sliders */
export const Sliders = createIcon(
  'Sliders',
  <>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </>
);

/** Star - favorite/rating */
export const Star = createIcon(
  'Star',
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
);

/** User check - verified user */
export const UserCheck = createIcon(
  'UserCheck',
  <>
    <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <polyline points="17 11 19 13 23 9" />
  </>
);

/** User X - rejected/blocked user */
export const UserX = createIcon(
  'UserX',
  <>
    <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="18" y1="8" x2="23" y2="13" />
    <line x1="23" y1="8" x2="18" y2="13" />
  </>
);

/** Wifi - connected */
export const Wifi = createIcon(
  'Wifi',
  <>
    <path d="M5 12.55a11 11 0 0114.08 0" />
    <path d="M1.42 9a16 16 0 0121.16 0" />
    <path d="M8.53 16.11a6 6 0 016.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </>
);

/** Wifi off - disconnected */
export const WifiOff = createIcon(
  'WifiOff',
  <>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
    <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
    <path d="M10.71 5.05A16 16 0 0122.58 9" />
    <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
    <path d="M8.53 16.11a6 6 0 016.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </>
);

/** Zoom in - magnify in */
export const ZoomIn = createIcon(
  'ZoomIn',
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </>
);

/** Zoom out - magnify out */
export const ZoomOut = createIcon(
  'ZoomOut',
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </>
);

/** Thumbs up - positive feedback */
export const ThumbsUp = createIcon(
  'ThumbsUp',
  <>
    <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
  </>
);

/** Thumbs down - negative feedback */
export const ThumbsDown = createIcon(
  'ThumbsDown',
  <>
    <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
  </>
);

/** Rocket - launch/deploy */
export const Rocket = createIcon(
  'Rocket',
  <>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </>
);

/** Target - goal/objective */
export const Target = createIcon(
  'Target',
  <>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </>
);

/** Hourglass - timer/wait */
export const Hourglass = createIcon(
  'Hourglass',
  <>
    <path d="M5 22h14" />
    <path d="M5 2h14" />
    <path d="M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22" />
    <path d="M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2" />
  </>
);

/** Arrow Right Left - transform/exchange */
export const ArrowRightLeft = createIcon(
  'ArrowRightLeft',
  <>
    <path d="M21 7H3" />
    <path d="M18 4l3 3-3 3" />
    <path d="M3 17h18" />
    <path d="M6 14l-3 3 3 3" />
  </>
);

/** Git Merge - merge/combine */
export const GitMerge = createIcon(
  'GitMerge',
  <>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 009 9" />
  </>
);

/** Hand - human interaction */
export const Hand = createIcon(
  'Hand',
  <>
    <path d="M18 11V6a2 2 0 10-4 0v5" />
    <path d="M14 10V4a2 2 0 10-4 0v6" />
    <path d="M10 10.5V6a2 2 0 10-4 0v8" />
    <path d="M18 8a2 2 0 114 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 012.83-2.82L7 15" />
  </>
);

/** Flask Conical - experiment/synthesis */
export const FlaskConical = createIcon(
  'FlaskConical',
  <>
    <path d="M10 2v7.527a2 2 0 01-.211.896L4.72 20.55a1 1 0 00.9 1.45h12.76a1 1 0 00.9-1.45l-5.069-10.127A2 2 0 0114 9.527V2" />
    <path d="M8.5 2h7" />
    <path d="M7 16.5h10" />
  </>
);

export const ExternalLink = createIcon(
  'ExternalLink',
  <>
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </>
);
