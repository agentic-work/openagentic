/**
 * Data validation utilities to prevent undefined errors
 */

import { ChatMessage, VisualizationData, PrometheusData } from '../types';

export function isValidChatMessage(message: any): message is ChatMessage {
  return (
    message &&
    typeof message === 'object' &&
    typeof message.id === 'string' &&
    typeof message.role === 'string' &&
    typeof message.content === 'string' &&
    ['user', 'assistant', 'system'].includes(message.role)
  );
}

export function isValidVisualizationData(data: any): data is VisualizationData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.type === 'string' &&
    typeof data.title === 'string' &&
    Array.isArray(data.data) &&
    data.data.length > 0
  );
}

export function isValidPrometheusData(data: any): data is PrometheusData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.metric === 'string' &&
    typeof data.value !== 'undefined'
  );
}

export function safeArrayAccess<T>(
  array: T[] | undefined | null,
  index: number,
  defaultValue: T | null = null
): T | null {
  if (!Array.isArray(array) || index < 0 || index >= array.length) {
    return defaultValue;
  }
  return array[index] ?? defaultValue;
}

export function safeObjectAccess<T, K extends keyof T>(
  obj: T | undefined | null,
  key: K,
  defaultValue: T[K] | null = null
): T[K] | null {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }
  return obj[key] ?? defaultValue;
}

export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

export function validateChartData(data: any[]): any[] {
  if (!Array.isArray(data)) {
    return [];
  }
  
  return data.filter(item => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    
    // Ensure all values are valid numbers or strings
    for (const key in item) {
      const value = item[key];
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === 'number' && !isFinite(value)) {
        return false;
      }
    }
    
    return true;
  });
}
