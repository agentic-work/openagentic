/**
 * Stub for UserContextService — only available in the main API service.
 * Workflow service gracefully degrades when this isn't available.
 */
export const userContextService = {
  indexUserData: async (..._args: any[]) => {},
  getContext: async (..._args: any[]) => '',
};
