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

import React from 'react';

interface AnimatedTokenCostProps {
  usage?: any;
  cost?: number;
  delay?: number;
  theme?: 'light' | 'dark';
  isVisible?: boolean;
  compact?: boolean;
}

const AnimatedTokenCost: React.FC<AnimatedTokenCostProps> = ({ usage, cost = 0, delay = 0, theme, isVisible, compact }) => {
  // Calculate cost from usage if provided
  const actualCost = usage?.totalTokens ? usage.totalTokens * 0.00001 : cost;
  
  return (
    <div className="animated-token-cost">
      {/* Token cost display - placeholder */}
      <span>{actualCost.toFixed(5)} tokens</span>
    </div>
  );
};

export default AnimatedTokenCost;