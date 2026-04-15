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

// React Flow Diagrams (flowcharts, architecture, etc.)
export {
  ReactFlowDiagram,
  parseDiagramJson,
  type DiagramDefinition,
  type DiagramNode,
  type DiagramEdge,
  type DiagramType,
  type NodeShape,
  type EdgeStyle,
} from './ReactFlowDiagram';

// Venn Diagrams
export {
  VennDiagram,
  parseVennJson,
  type VennDefinition,
  type VennSet,
  type VennIntersection,
} from './VennDiagram';

// Data Charts (line, bar, area, pie, donut)
export {
  DataChart,
  parseChartJson,
  type ChartDefinition,
  type ChartType,
  type DataPoint,
  type ChartSeries,
} from './DataChart';

// Draw.io Diagrams
export {
  DrawioDiagramViewer,
  parseDrawioResult,
  type DrawioDiagramViewerProps,
  type DrawioResult,
  type DrawioMetadata,
} from './DrawioDiagramViewer';
