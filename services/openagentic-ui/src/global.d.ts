/**
 * Global type definitions
 */

interface Window {
  showNotification?: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

// Module declarations for third-party libraries without type definitions
declare module 'jspdf' {
  const jsPDF: any;
  export default jsPDF;
}

declare module 'html2canvas' {
  const html2canvas: any;
  export default html2canvas;
}

declare module 'html2pdf.js' {
  const html2pdf: any;
  export default html2pdf;
}